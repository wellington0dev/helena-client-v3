import { downloadMediaMessage, isJidGroup, makeWASocket, useMultiFileAuthState, DisconnectReason } from "baileys";
import type { Contact, WAMessage, WASocket } from "baileys";
import pino from "pino";
import QRCode from "qrcode";
import { config } from "../config.ts";
import { updateWhatsapp } from "../panel/status-bus.ts";
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

/**
 * WhatsApp vem migrando conversa 1:1 pro formato "@lid" (identificador
 * interno, opaco — NÃO é o número de telefone) em vez do clássico
 * "<número>@s.whatsapp.net" — bug real reportado: o dono cadastrou o
 * próprio número (`PATCH /auth/me/owner-identity`), mas a mensagem chegava
 * com `remoteJid` tipo "23115665015007@lid", que nunca bate com nenhum
 * número — a Helena tratava o próprio dono como contato externo.
 *
 * Baileys expõe o par lid↔jid (telefone) via `Contact` nos eventos
 * `contacts.upsert`/`contacts.update` (sincronizados normalmente ao
 * conectar) — guarda esse mapeamento aqui pra resolver o telefone de
 * verdade antes de mandar `contactId` pro backend-v2. Isso NUNCA afeta pra
 * onde a resposta é enviada de volta (`sendWhatsappMessage` continua
 * usando o `remoteJid` cru — é o único endereço que o Baileys aceita pra
 * rotear a mensagem de volta, LID ou não).
 */
const lidToPhoneJid = new Map<string, string>();

/** Exportada só pra teste (lógica pura, sem depender de socket real) — não é chamada de fora deste módulo em produção. */
export function trackContactMapping(contacts: Partial<Contact>[]): void {
    for (const contact of contacts) {
        if (contact.lid && contact.jid) lidToPhoneJid.set(contact.lid, contact.jid);
    }
}

/** `remoteJid` cru → JID de telefone, se a gente já souber o mapeamento (ver trackContactMapping). Sem mapeamento conhecido, devolve o mesmo `@lid` de entrada — nunca inventa número, só não resolve ainda (mesmo efeito de antes desta correção). Exportada só pra teste, mesmo motivo de trackContactMapping. */
export function resolvePhoneContactId(remoteJid: string): string {
    if (!remoteJid.endsWith("@lid")) return remoteJid;
    return lidToPhoneJid.get(remoteJid) ?? remoteJid;
}

export async function sendWhatsappMessage(jid: string, text: string): Promise<void> {
    if (!currentSock) throw new Error("WhatsApp não está conectado.");
    for (const chunk of toWhatsappText(text).split("\n\n")) {
        await currentSock.sendMessage(jid, { text: chunk });
    }
}

function textOf(msg: WAMessage): string | undefined {
    return msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? undefined;
}

/** fileLength do Baileys pode vir como number ou Long — normaliza pra number puro (mesmo helper do backend single-owner). */
function toNumber(value: number | { toString(): string } | null | undefined): number | undefined {
    if (value === null || value === undefined) return undefined;
    return typeof value === "number" ? value : Number(value.toString());
}

async function downloadImage(msg: WAMessage, sock: WASocket): Promise<Buffer> {
    return downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
}

async function handleMessage(msg: WAMessage, sock: WASocket): Promise<void> {
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || msg.key.fromMe) return;

    const text = textOf(msg);
    const imageMessage = msg.message?.imageMessage;

    if (!text && !imageMessage) return; // outra mídia (áudio/vídeo/documento): fora de escopo desta leva, ignora silenciosamente.

    try {
        if (imageMessage && exceedsMediaLimit(toNumber(imageMessage.fileLength))) {
            await sendWhatsappMessage(remoteJid, mediaTooLargeMessage());
            return;
        }

        const image = imageMessage
            ? { mimeType: imageMessage.mimetype || "image/jpeg", base64: (await downloadImage(msg, sock)).toString("base64"), caption: imageMessage.caption ?? undefined }
            : undefined;

        const result = await sendInboundMessage(config.backendUrl, config.backendApiToken, {
            channel: "whatsapp",
            contactId: resolvePhoneContactId(remoteJid),
            senderName: msg.pushName || undefined,
            text,
            image,
        });
        if ("blocked" in result) return; // rate limit — sem resposta, mesmo comportamento do backend single-owner.

        await sendWhatsappMessage(remoteJid, result.text);
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

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("contacts.upsert", trackContactMapping);
    sock.ev.on("contacts.update", trackContactMapping);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            updateWhatsapp({ status: "qr" });
            QRCode.toDataURL(qr)
                .then((qrDataUrl) => updateWhatsapp({ status: "qr", qrDataUrl }))
                .catch((error) => console.error("[whatsapp] falha ao gerar QR pro painel:", error));
        }

        if (connection === "open") {
            console.log("[whatsapp] conectado.");
            currentSock = sock;
            updateWhatsapp({ status: "connected", qrDataUrl: undefined, error: undefined });
        }

        if (connection === "close") {
            currentSock = undefined;
            const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
            if (statusCode === DisconnectReason.loggedOut) {
                const message = "sessão desconectada (logout) — apague o diretório de auth e reinicie pra escanear um QR novo.";
                console.error(`[whatsapp] ${message}`);
                updateWhatsapp({ status: "error", error: message, qrDataUrl: undefined });
                return;
            }
            updateWhatsapp({ status: "connecting", qrDataUrl: undefined });
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

    updateWhatsapp({ status: "connecting" });
    connect().catch((error) => {
        console.error("[whatsapp] falha ao conectar:", error);
        updateWhatsapp({ status: "error", error: error instanceof Error ? error.message : String(error) });
    });
}
