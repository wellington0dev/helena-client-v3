import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { downloadMediaMessage, isJidGroup, makeWASocket, useMultiFileAuthState, DisconnectReason } from "baileys";
import type { WAMessage, WASocket } from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { config } from "../config.ts";
import { getState, updateWhatsapp } from "../local-api/status-bus.ts";
import { sendGroupInboundMessage, sendInboundMessage } from "./backend-client.ts";
import { exceedsMediaLimit, mediaTooLargeMessage } from "./media-limit.ts";
import { toWhatsappText } from "./markdown-format.ts";

/**
 * Ponte de WhatsApp pro backend-v2 (Fase 5 — ver docs/architecture-v2.md
 * §4), agora rodando dentro do client/ (não mais um processo `cli/`
 * separado) — o QR vai pro painel local (`status-bus.ts`) em vez de só
 * terminal, e a falta de config vira um status "disconnected" reportado no
 * painel em vez de `process.exit` (este processo também sobe o painel e,
 * possivelmente, o Telegram — encerrar o processo inteiro por falta de UM
 * canal configurado derrubaria os outros).
 *
 * Mesma simplificação da leva anterior no cli/, deliberada: mensagem 1:1
 * vira contato EXTERNO pro backend-v2 (sempre restrictedChatAgent) — a
 * conversa do próprio tenant com a Helena é só pelo painel web (JWT).
 * Mensagem de GRUPO (seção de Grupos do doc de arquitetura) tem seu
 * próprio fluxo — detecção de menção/reply mora AQUI (só o client/ tem
 * acesso a `contextInfo.mentionedJid`/`contextInfo.participant` do
 * Baileys), o backend-v2 só recebe `mentioned: boolean` já resolvido.
 */

const RECONNECT_DELAY_MS = 3000;
const logger = pino({ level: "silent" });

/** Instância ativa, pro outbound-poller conseguir mandar mensagem por iniciativa do backend (lembrete de calendário, aviso de pagamento — ver outbound-poller.ts). `undefined` enquanto não conectado. */
let currentSock: WASocket | undefined;
/** Socket em andamento (inclusive antes do `open`, ex.: aguardando o QR) — `currentSock` só existe depois de conectado, então parar/desvincular durante o QR precisa desta. */
let activeSock: WASocket | undefined;

/**
 * `true` só durante um `stopWhatsapp()` em andamento — evita que o handler
 * de `connection === "close"` (disparado pelo PRÓPRIO `sock.end()` do
 * shutdown) agende uma reconexão brigando com o processo saindo.
 */
let shuttingDown = false;

/**
 * Última gravação de credenciais em andamento (`useMultiFileAuthState`
 * escreve com `fs/promises.writeFile` puro, sem escrita atômica — confirmado
 * lendo o próprio código-fonte do Baileys) — bug real reportado: toda vez
 * que `update.sh` reinicia o serviço (`systemctl restart`, manda SIGTERM),
 * se o processo morrer no MEIO dessa escrita, o arquivo de credencial fica
 * truncado/corrompido, e a sessão aparece desvinculada (exige QR novo) na
 * próxima subida — não é "às vezes trava", é uma corrida de verdade contra
 * qualquer `creds.update` (que dispara a cada rotação de chave, com
 * frequência). `stopWhatsapp()` espera essa promise antes de deixar o
 * processo sair, pra nunca interromper uma escrita no meio.
 */
let pendingCredsSave: Promise<void> = Promise.resolve();

/**
 * WhatsApp vem migrando conversa 1:1 pro formato "@lid" (identificador
 * interno, opaco — NÃO é o número de telefone) em vez do clássico
 * "<número>@s.whatsapp.net" — bug real reportado: o dono cadastrou o
 * próprio número (`PATCH /auth/me/owner-identity`), mas a mensagem chegava
 * com `remoteJid` tipo "23115665015007@lid", que nunca bate com nenhum
 * número — a Helena tratava o próprio dono como contato externo.
 *
 * Tentativa anterior (removida): escutar `contacts.upsert`/`contacts.update`
 * pra aprender o par lid↔telefone. Não funcionou ao vivo pra este caso real
 * — investigando o código do backend single-owner de antes desta migração
 * (`identity.ts`, removido do monorepo legado em 7630e6f9 mas recuperável
 * via git), o mecanismo que REALMENTE funcionava era outro: Baileys anexa
 * o telefone de verdade em `msg.key.senderPn` (não é evento de sync de
 * contato — é um campo que o SERVIDOR do WhatsApp decide incluir ou não em
 * CADA mensagem individual; confirmado no próprio código-fonte do Baileys,
 * `WAMessageKey.senderPn`). A ausência de `senderPn` numa mensagem não
 * significa "só na primeira" — pra alguns contatos ele nunca aparece (ver
 * WhiskeySockets/Baileys#1718, #1768) — por isso pina o mapeamento em disco
 * assim que aparecer uma vez, e reusa o pin quando faltar depois (mesma
 * estratégia do código antigo, adaptada: aqui não decide dono/convidado,
 * só resolve o `contactId` que vai pro backend-v2, que decide dono via
 * `whatsappOwnerNumber`). Isso NUNCA afeta pra onde a resposta é enviada de
 * volta (`sendWhatsappMessage` continua usando o `remoteJid` cru — é o
 * único endereço que o Baileys aceita pra rotear de volta, LID ou não).
 */
function isLidJid(jid: string): boolean {
    return jid.endsWith("@lid");
}

function loadLidPins(): Record<string, string> {
    try {
        return JSON.parse(readFileSync(config.whatsappLidPinsFile, "utf8")) as Record<string, string>;
    } catch {
        return {};
    }
}

let lidPins: Record<string, string> = loadLidPins();

/**
 * Decide o `contactId` a partir do `remoteJid`/`senderPn` e do que já se
 * sabe em `pins` — pura (sem I/O, sem mutar nada), pra testar sem depender
 * de arquivo real. `senderPn` presente sempre vence (é o dado mais fresco);
 * sem ele, cai pro pin conhecido; sem pin nenhum, devolve o próprio `@lid`
 * de entrada — nunca inventa número.
 */
export function resolveContactIdPure(remoteJid: string, senderPn: string | undefined, pins: Readonly<Record<string, string>>): string {
    if (!isLidJid(remoteJid)) return remoteJid;
    if (senderPn) return senderPn;
    return pins[remoteJid] ?? remoteJid;
}

/** Efeito colateral de resolveContactIdPure: aprende e persiste o pin em disco quando `senderPn` traz informação nova. Nunca lança — falha de disco não pode derrubar o processamento da mensagem. */
function resolvePhoneContactId(remoteJid: string, senderPn: string | undefined): string {
    const resolved = resolveContactIdPure(remoteJid, senderPn, lidPins);

    if (senderPn && isLidJid(remoteJid) && lidPins[remoteJid] !== senderPn) {
        lidPins = { ...lidPins, [remoteJid]: senderPn };
        try {
            writeFileSync(config.whatsappLidPinsFile, JSON.stringify(lidPins, null, 2), "utf8");
        } catch (error) {
            console.error("[whatsapp] falha ao gravar pin de lid→telefone:", error);
        }
    }

    return resolved;
}

export async function sendWhatsappMessage(jid: string, text: string): Promise<void> {
    if (!currentSock) throw new Error("WhatsApp não está conectado.");
    for (const chunk of toWhatsappText(text).split("\n\n")) {
        await currentSock.sendMessage(jid, { text: chunk });
    }
}

/** Mesmo formato aceito no reply de um turno normal (ver handleMessage) — usado tanto ali quanto pelo outbound-poller (message_contact com stickerId). */
export async function sendWhatsappSticker(jid: string, base64: string): Promise<void> {
    if (!currentSock) throw new Error("WhatsApp não está conectado.");
    await currentSock.sendMessage(jid, { sticker: Buffer.from(base64, "base64") });
}

function textOf(msg: WAMessage): string | undefined {
    return msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? undefined;
}

/** fileLength do Baileys pode vir como number ou Long — normaliza pra number puro (mesmo helper do backend single-owner). */
function toNumber(value: number | { toString(): string } | null | undefined): number | undefined {
    if (value === null || value === undefined) return undefined;
    return typeof value === "number" ? value : Number(value.toString());
}

/** Genérico o bastante pra imagem E figurinha — downloadMediaMessage do Baileys não distingue tipo de mídia. */
async function downloadMedia(msg: WAMessage, sock: WASocket): Promise<Buffer> {
    return downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
}

async function handleMessage(msg: WAMessage, sock: WASocket): Promise<void> {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || msg.key.fromMe) return;

    const text = textOf(msg);
    const imageMessage = msg.message?.imageMessage;
    const stickerMessage = msg.message?.stickerMessage;

    if (!text && !imageMessage && !stickerMessage) return; // outra mídia (áudio/vídeo/documento): fora de escopo desta leva, ignora silenciosamente.

    try {
        if (imageMessage && exceedsMediaLimit(toNumber(imageMessage.fileLength))) {
            await sendWhatsappMessage(remoteJid, mediaTooLargeMessage());
            return;
        }
        if (stickerMessage && exceedsMediaLimit(toNumber(stickerMessage.fileLength))) {
            await sendWhatsappMessage(remoteJid, mediaTooLargeMessage());
            return;
        }

        const image = imageMessage
            ? { mimeType: imageMessage.mimetype || "image/jpeg", base64: (await downloadMedia(msg, sock)).toString("base64"), caption: imageMessage.caption ?? undefined }
            : undefined;

        // Estática ou animada, o formato de verdade continua sendo webp (diferente do Telegram, onde animado é TGS/Lottie — outro formato) — ver stickerMimeType em telegram.ts pro caso diferente.
        const sticker = stickerMessage
            ? { mimeType: stickerMessage.mimetype || "image/webp", base64: (await downloadMedia(msg, sock)).toString("base64"), animated: stickerMessage.isAnimated ?? false }
            : undefined;

        const result = await sendInboundMessage(config.backendUrl, config.backendApiToken, {
            channel: "whatsapp",
            contactId: resolvePhoneContactId(remoteJid, msg.key.senderPn),
            senderName: msg.pushName || undefined,
            text,
            image,
            sticker,
        });
        if ("blocked" in result) return; // rate limit — sem resposta, mesmo comportamento do backend single-owner.

        await sendWhatsappMessage(remoteJid, result.text);
        if (result.sticker) await sendWhatsappSticker(remoteJid, result.sticker.base64);
    } catch (error) {
        console.error("[whatsapp] falha ao processar mensagem:", error);
    }
}

/** Remove o sufixo de dispositivo (":12" em "5511...:12@s.whatsapp.net") — sem isso, o mesmo número em dois aparelhos nunca bateria como "é a própria Helena mencionada". */
function normalizeJid(jid: string): string {
    return `${jid.split(":")[0]!.split("@")[0]}@s.whatsapp.net`;
}

function isMentioned(msg: WAMessage): boolean {
    if (!currentSock?.user?.id) return false;
    const ownJid = normalizeJid(currentSock.user.id);

    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const mentionedJids = contextInfo?.mentionedJid ?? [];
    if (mentionedJids.some((jid) => normalizeJid(jid) === ownJid)) return true;

    const repliedParticipant = contextInfo?.participant;
    return repliedParticipant ? normalizeJid(repliedParticipant) === ownJid : false;
}

async function handleGroupMessage(msg: WAMessage): Promise<void> {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || msg.key.fromMe) return;

    const text = textOf(msg);
    if (!text) return; // mídia: fora de escopo desta leva.

    const mentioned = isMentioned(msg);

    // Nome do grupo não vem em toda mensagem — busca via API do Baileys.
    // Falha (grupo saiu da lista, erro de rede) cai pro JID cru como
    // fallback, nunca bloqueia o processamento da mensagem por causa disso.
    let groupName = remoteJid;
    try {
        const metadata = await currentSock?.groupMetadata(remoteJid);
        if (metadata?.subject) groupName = metadata.subject;
    } catch (error) {
        console.error(`[whatsapp] falha ao buscar nome do grupo ${remoteJid}:`, error);
    }

    try {
        const result = await sendGroupInboundMessage(config.backendUrl, config.backendApiToken, {
            channel: "whatsapp",
            groupId: remoteJid,
            groupName,
            senderName: msg.pushName || "alguém",
            text,
            mentioned,
        });
        if ("noReply" in result || "blocked" in result) return;

        await sendWhatsappMessage(remoteJid, result.text);
    } catch (error) {
        console.error("[whatsapp] falha ao processar mensagem de grupo:", error);
    }
}

async function connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(config.whatsappAuthDir);
    const sock = makeWASocket({ auth: state, logger, printQRInTerminal: false });
    activeSock = sock;

    sock.ev.on("creds.update", () => {
        pendingCredsSave = saveCreds().catch((error) => console.error("[whatsapp] falha ao salvar credenciais:", error));
    });

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            updateWhatsapp({ status: "qr", qrText: qr });
            QRCode.toDataURL(qr)
                .then((qrDataUrl) => updateWhatsapp({ status: "qr", qrDataUrl, qrText: qr }))
                .catch((error) => console.error("[whatsapp] falha ao gerar QR pro painel:", error));
        }

        if (connection === "open") {
            console.log("[whatsapp] conectado.");
            currentSock = sock;
            updateWhatsapp({ status: "connected", qrDataUrl: undefined, qrText: undefined, error: undefined });
        }

        if (connection === "close") {
            currentSock = undefined;
            const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                activeSock = undefined; // sessão morreu: permite `start`/`logout` pela API local sem ficar preso no guard de idempotência
                const message = "sessão desconectada (logout) — apague o diretório de auth e reinicie pra escanear um QR novo.";
                console.error(`[whatsapp] ${message}`);
                updateWhatsapp({ status: "error", error: message, qrDataUrl: undefined, qrText: undefined });
                return;
            }
            if (shuttingDown) return; // fomos nós que fechamos (stopWhatsapp) — não reconecta brigando com o processo saindo.
            updateWhatsapp({ status: "connecting", qrDataUrl: undefined, qrText: undefined });
            setTimeout(() => connect().catch((error) => console.error("[whatsapp] falha ao reconectar:", error)), RECONNECT_DELAY_MS);
        }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
            const remoteJid = msg.key.remoteJid;
            if (remoteJid && isJidGroup(remoteJid)) {
                handleGroupMessage(msg).catch((error) => console.error("[whatsapp] erro processando mensagem de grupo:", error));
            } else {
                handleMessage(msg, sock).catch((error) => console.error("[whatsapp] erro processando mensagem:", error));
            }
        }
    });
}

/** Não lança — falha de configuração só reporta status "error" no painel, deixando o resto do client/ (painel, Telegram) de pé. */
export function startWhatsapp(): void {
    if (!config.backendUrl || !config.backendApiToken) {
        updateWhatsapp({ status: "error", error: "BACKEND_V2_URL/BACKEND_V2_API_TOKEN não configurados no .env." });
        return;
    }

    if (currentSock || activeSock) return; // já conectado/conectando — idempotente (start pela API local não duplica o socket)
    shuttingDown = false; // permite religar depois de um stop/logout feito pela API local
    updateWhatsapp({ status: "connecting" });
    connect().catch((error) => {
        console.error("[whatsapp] falha ao conectar:", error);
        updateWhatsapp({ status: "error", error: error instanceof Error ? error.message : String(error) });
    });
}

/**
 * Chamada no shutdown (ver main.ts) — fecha a conexão de forma limpa
 * (`sock.end()`, NUNCA `sock.logout()`: logout invalidaria a sessão de
 * propósito, e um restart de rotina não deveria fazer isso) e espera
 * qualquer gravação de credenciais em andamento terminar antes do processo
 * sair de verdade. Sem isso, `systemctl restart` (usado por update.sh a
 * cada atualização) podia matar o processo no meio de uma escrita e
 * corromper o arquivo de auth — ver comentário de `pendingCredsSave`. Nunca
 * lança — melhor esperar até um timeout curto do que travar o shutdown pra
 * sempre se algo aqui falhar.
 */
export async function stopWhatsapp(): Promise<void> {
    shuttingDown = true;
    (activeSock ?? currentSock)?.end(undefined);
    activeSock = undefined;
    try {
        await pendingCredsSave;
    } catch {
        // já logado dentro do próprio saveCreds acima — aqui só garante que o await não derruba o shutdown.
    }
    // O handler de "close" sai cedo quando `shuttingDown` (pra não reconectar) e por isso NUNCA atualizava o status: cancelar
    // a conexão/QR pela API local deixava o estado preso em "qr"/"connecting" com o QR velho na tela. Sessão preservada; só o status muda.
    if (getState().whatsapp.status !== "error") updateWhatsapp({ status: "disconnected", qrDataUrl: undefined, qrText: undefined });
}

/**
 * Desvincula o aparelho de verdade (`sock.logout()` invalida a sessão no WhatsApp) e apaga o diretório de auth
 * local — o próximo `startWhatsapp()` pede um QR novo. Diferente de `stopWhatsapp` (restart de rotina, que
 * PRESERVA a sessão). Chamado só por ação explícita do usuário (`POST /v1/channels/whatsapp/logout`).
 */
export async function logoutWhatsapp(): Promise<void> {
    shuttingDown = true;
    const sock = activeSock ?? currentSock;
    try {
        await sock?.logout();
    } catch (error) {
        console.error("[whatsapp] logout no servidor falhou (segue apagando o auth local):", error);
    }
    sock?.end(undefined);
    activeSock = undefined;
    currentSock = undefined;
    try {
        await pendingCredsSave;
    } catch {
        // idem stopWhatsapp
    }
    rmSync(config.whatsappAuthDir, { recursive: true, force: true });
    updateWhatsapp({ status: "disconnected", qrDataUrl: undefined, qrText: undefined, error: undefined });
}
