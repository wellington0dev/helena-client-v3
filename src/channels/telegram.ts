import { randomBytes } from "node:crypto";
import { Api, Bot, InputFile, type Context } from "grammy";
import { hydrateFiles, type FileFlavor } from "@grammyjs/files";
import { config } from "../config.ts";
import { updateTelegram } from "../local-api/status-bus.ts";
import { sendGroupInboundMessage, sendInboundMessage } from "./backend-client.ts";
import { exceedsMediaLimit, mediaTooLargeMessage } from "./media-limit.ts";
import { toTelegramContent, toTelegramHtml, type TelegramButtonRow } from "./markdown-format.ts";
import { captureError } from "../telemetry.ts";

/** Telegram tem 3 formatos de figurinha, bem diferentes — webp (estática), TGS/Lottie (animada) e webm (vídeo). `getFile()` não devolve o mimetype certo sozinho, então infere pelas flags do próprio sticker. Exportada só pra teste (lógica pura). */
export function stickerMimeType(sticker: { is_animated: boolean; is_video: boolean }): string {
    if (sticker.is_video) return "video/webm";
    if (sticker.is_animated) return "application/x-tgsticker";
    return "image/webp";
}

/** FileFlavor adiciona `ctx.getFile()` (plugin @grammyjs/files), que já resolve o file_id certo pro tipo de mídia da mensagem atual — precisa pra baixar a foto antes de mandar pro backend-v2. */
type TelegramContext = FileFlavor<Context>;

/**
 * Ponte de Telegram pro backend-v2 — mesma simplificação do whatsapp.ts:
 * mensagem 1:1 vira contato externo (`restrictedChatAgent`), sem
 * distinção de "dono" (isso é o painel web/JWT agora). Mensagem de GRUPO/
 * supergrupo tem seu próprio fluxo (ver Grupos no doc de arquitetura) —
 * detecção de menção/reply mora AQUI (só o client/ tem acesso a
 * `ctx.entities()`/`reply_to_message` do grammy).
 *
 * IMPORTANTE — pré-requisito FORA do código: por padrão, um bot do
 * Telegram só recebe menções diretas/replies/comandos em grupo, NUNCA o
 * fluxo geral de texto (Privacy Mode, ligado por padrão) — sem desligar
 * isso no @BotFather (`/setprivacy` → Disable), o buffer de contexto do
 * grupo fica vazio (o bot nunca vê as mensagens que não o mencionam).
 */

/** Instância ativa, pro outbound-poller (ver outbound-poller.ts). `undefined` enquanto não conectado. */
let currentBot: Bot<TelegramContext> | undefined;
/** Bot em andamento (inclusive antes do `onStart`) — pra `stopTelegram` conseguir parar o polling a qualquer momento. */
let activeBot: Bot<TelegramContext> | undefined;

/**
 * Mapa token → { chatId, answer } pros botões de inline keyboard. `callback_data` do Telegram é
 * limitado a 64 BYTES, então o botão carrega só um token opaco; o texto de resposta (que pode ser
 * longo — ex.: "Pergunta: opção com nome comprido") vive aqui até o clique. Um clique CONSOME a
 * entrada (o mesmo botão não responde duas vezes) e um teto descarta as mais antigas (o processo é
 * de longa duração e cada mensagem com botões gera entradas novas).
 */
const CALLBACK_ENTRIES_MAX = 500;
const callbackAnswers = new Map<string, { chatId: string; answer: string }>();

/** Guarda a resposta de um botão e devolve o token curto que vai no `callback_data`. */
function rememberCallback(chatId: string, answer: string): string {
    const token = randomBytes(9).toString("base64url"); // 12 chars — folga enorme sob os 64 bytes do callback_data
    callbackAnswers.set(token, { chatId, answer });
    while (callbackAnswers.size > CALLBACK_ENTRIES_MAX) {
        const oldest = callbackAnswers.keys().next().value;
        if (oldest === undefined) break;
        callbackAnswers.delete(oldest);
    }
    return token;
}

/** Recupera e JÁ consome a resposta de um token (clique único). */
function takeCallback(token: string): { chatId: string; answer: string } | undefined {
    const entry = callbackAnswers.get(token);
    if (entry) callbackAnswers.delete(token);
    return entry;
}

/** Rótulo de botão do Telegram tem limite prático (~64 chars) — corta com reticências sem perder o `answer` (que fica inteiro no registro). */
function truncateButtonText(text: string): string {
    const max = 64;
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Monta o `reply_markup` a partir das linhas de `toTelegramContent`; `undefined` quando a mensagem não tem interação. */
function buildReplyMarkup(chatId: string, rows: TelegramButtonRow[]): { inline_keyboard: { text: string; callback_data: string }[][] } | undefined {
    if (!rows.length) return undefined;
    return {
        inline_keyboard: rows.map((row) => row.map((btn) => ({ text: truncateButtonText(btn.text), callback_data: rememberCallback(chatId, btn.answer) }))),
    };
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
    if (!currentBot) throw new Error("Telegram não está conectado.");
    const { html, rows } = toTelegramContent(text);
    const replyMarkup = buildReplyMarkup(chatId, rows);
    await currentBot.api.sendMessage(chatId, html, { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}

/** Mesmo formato aceito no reply de um turno normal (ver handlePrivateMessage) — usado tanto ali quanto pelo outbound-poller (message_contact com stickerId). */
export async function sendTelegramSticker(chatId: string, base64: string): Promise<void> {
    if (!currentBot) throw new Error("Telegram não está conectado.");
    await currentBot.api.sendSticker(chatId, new InputFile(Buffer.from(base64, "base64")));
}

/** Responde no 1:1 (via `ctx.reply`) já com os botões nativos quando a resposta tiver bloco interativo — mesma conversão de `sendTelegramMessage`. */
async function replyWithTelegramContent(ctx: TelegramContext, text: string): Promise<void> {
    const chatId = String(ctx.from?.id ?? ctx.chat?.id ?? "");
    const { html, rows } = toTelegramContent(text);
    const replyMarkup = buildReplyMarkup(chatId, rows);
    await ctx.reply(html, { parse_mode: "HTML", ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
}

function isMentioned(ctx: Context): boolean {
    const botInfo = currentBot?.botInfo;
    if (!botInfo) return false;

    for (const entity of ctx.entities(["mention", "text_mention"])) {
        if (entity.type === "text_mention" && entity.user.id === botInfo.id) return true;
        if (entity.type === "mention" && entity.text.toLowerCase() === `@${botInfo.username.toLowerCase()}`) return true;
    }

    return ctx.message?.reply_to_message?.from?.id === botInfo.id;
}

async function handlePrivateMessage(ctx: TelegramContext): Promise<void> {
    const text = ctx.message?.text;
    const photo = ctx.message?.photo;
    const stickerMsg = ctx.message?.sticker;
    const voice = ctx.message?.voice;
    const audioMsg = ctx.message?.audio;
    const audioFile = voice ?? audioMsg;
    if (!text && !photo && !stickerMsg && !audioFile) return; // vídeo/documento seguem fora do escopo.
    if (!ctx.from) return;

    try {
        if (photo && exceedsMediaLimit(photo[photo.length - 1]!.file_size)) {
            await ctx.reply(mediaTooLargeMessage());
            return;
        }
        if (stickerMsg && exceedsMediaLimit(stickerMsg.file_size)) {
            await ctx.reply(mediaTooLargeMessage());
            return;
        }
        if (audioFile && exceedsMediaLimit(audioFile.file_size)) {
            await ctx.reply(mediaTooLargeMessage("áudio"));
            return;
        }

        const image = photo
            ? { mimeType: "image/jpeg", base64: Buffer.from(await (await fetch((await ctx.getFile()).getUrl())).arrayBuffer()).toString("base64"), caption: ctx.message?.caption }
            : undefined;

        const sticker = stickerMsg
            ? {
                  mimeType: stickerMimeType(stickerMsg),
                  base64: Buffer.from(await (await fetch((await ctx.getFile()).getUrl())).arrayBuffer()).toString("base64"),
                  animated: stickerMsg.is_animated || stickerMsg.is_video,
                  emoji: stickerMsg.emoji,
                  telegramFileId: stickerMsg.file_id,
              }
            : undefined;

        const audio = audioFile
            ? {
                  mimeType: audioFile.mime_type || (voice ? "audio/ogg" : "audio/mpeg"),
                  base64: Buffer.from(await (await fetch((await ctx.getFile()).getUrl())).arrayBuffer()).toString("base64"),
              }
            : undefined;

        const result = await sendInboundMessage({
            channel: "telegram",
            contactId: String(ctx.from.id),
            senderName: ctx.from.first_name || undefined,
            text,
            image,
            audio,
            sticker,
        });
        if ("blocked" in result) return;

        await replyWithTelegramContent(ctx, result.text);
        if (result.sticker) await ctx.replyWithSticker(new InputFile(Buffer.from(result.sticker.base64, "base64")));
    } catch (error) {
        captureError("telegram", "falha ao processar mensagem", error);
    }
}

async function handleGroupMessage(ctx: Context): Promise<void> {
    const text = ctx.message?.text;
    if (!text || !ctx.from || !ctx.chat) return;

    const mentioned = isMentioned(ctx);
    const groupId = String(ctx.chat.id);
    const groupName = ("title" in ctx.chat ? ctx.chat.title : undefined) ?? groupId;

    try {
        const result = await sendGroupInboundMessage({
            channel: "telegram",
            groupId,
            groupName,
            senderName: ctx.from.first_name || "alguém",
            text,
            mentioned,
        });
        if ("noReply" in result || "blocked" in result) return;

        await ctx.reply(toTelegramHtml(result.text), { parse_mode: "HTML" });
    } catch (error) {
        captureError("telegram", "falha ao processar mensagem de grupo", error);
    }
}

/**
 * Clique num botão de inline keyboard (Fase 2 — Telegram nativo). O botão carrega só um token; aqui a
 * gente recupera o texto de resposta equivalente e manda como uma mensagem de texto NORMAL pro
 * backend-v2 (`sendInboundMessage`) — o contrato com o agente não muda em nada, ele nem sabe que foi
 * um clique (docs/formato-interativo-chat.md §2). Tira o "reloginho" e some com o teclado da mensagem
 * original (um clique já consumiu o token; sem isso o botão continuaria clicável pra sempre).
 */
async function handleCallbackQuery(ctx: TelegramContext): Promise<void> {
    const data = ctx.callbackQuery?.data;
    if (!data || !ctx.from) {
        await ctx.answerCallbackQuery().catch(() => {});
        return;
    }

    const entry = takeCallback(data);
    if (!entry || entry.chatId !== String(ctx.from.id)) {
        await ctx.answerCallbackQuery({ text: "Essa opção expirou. Envie uma nova mensagem." }).catch(() => {});
        return;
    }

    // Best-effort: tira o spinner e remove o teclado da mensagem original (pode falhar por mensagem
    // antiga/inalcançável — não impede a resposta de seguir).
    await ctx.answerCallbackQuery().catch(() => {});
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } }).catch(() => {});

    try {
        const result = await sendInboundMessage({
            channel: "telegram",
            contactId: String(ctx.from.id),
            senderName: ctx.from.first_name || undefined,
            text: entry.answer,
        });
        if ("blocked" in result) return;

        await replyWithTelegramContent(ctx, result.text);
        if (result.sticker) await ctx.replyWithSticker(new InputFile(Buffer.from(result.sticker.base64, "base64")));
    } catch (error) {
        captureError("telegram", "falha ao processar clique de botão", error);
    }
}

export function startTelegram(): void {
    if (!config.backendUrl) {
        updateTelegram({ status: "error", error: "URL do backend central não configurada." });
        return;
    }
    if (!config.telegramBotToken) {
        updateTelegram({ status: "disconnected" }); // Telegram é opcional — sem token, só fica "desconectado" (não é um erro de config faltando).
        return;
    }

    if (activeBot) return; // já rodando — idempotente
    updateTelegram({ status: "connecting" });

    const bot = new Bot<TelegramContext>(config.telegramBotToken);
    activeBot = bot;
    bot.api.config.use(hydrateFiles(bot.token));

    bot.catch((error) => {
        captureError("telegram", "erro não tratado no bot", error);
        updateTelegram({ status: "error", error: error instanceof Error ? error.message : String(error) });
    });

    bot.on("message", async (ctx) => {
        if (!ctx.chat) return;
        if (ctx.chat.type === "private") return handlePrivateMessage(ctx);
        if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") return handleGroupMessage(ctx);
        // "channel": fora de escopo, ignora.
    });

    bot.on("callback_query:data", handleCallbackQuery);

    bot.start({
        onStart: () => {
            console.log("[telegram] conectado.");
            currentBot = bot;
            updateTelegram({ status: "connected", error: undefined });
        },
    });
}

/** Para o polling (ação explícita pela API local, ou troca de token). Não lança. */
export async function stopTelegram(): Promise<void> {
    const bot = activeBot;
    activeBot = undefined;
    currentBot = undefined;
    try {
        await bot?.stop();
    } catch (error) {
        captureError("telegram", "falha ao parar", error, "warn");
    }
    updateTelegram({ status: "disconnected", error: undefined });
}

/**
 * Confere se o token FALA DE VERDADE com a API do Telegram, ANTES de persistir (`GET /v1/channels/telegram/token`) —
 * achado ao vivo (2026-09-21): um token com o FORMATO certo (dígitos:segredo, ver `validateBotToken` no client) mas
 * corrompido (ex: caracteres fora de ordem) passava na validação de formato e só falhava depois, silenciosamente,
 * quando o `startTelegram()` seguinte não conseguia autenticar — o dono via "conectando..." parado, sem erro claro.
 * `new Api(token)` não abre conexão persistente nem interfere no bot já rodando (`startTelegram`/`stopTelegram`
 * usam sua PRÓPRIA instância de `Bot`) — é só uma chamada HTTP avulsa.
 */
export async function validateTelegramToken(token: string, timeoutMs = 10_000): Promise<{ ok: true; botUsername: string } | { ok: false; error: string }> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let me: Awaited<ReturnType<Api["getMe"]>>;
        try {
            // grammy tipa `signal` contra o polyfill do pacote `abort-controller`, não o AbortSignal nativo do Node — mesma
            // interface em runtime (EventTarget com `aborted`/evento "abort"), só o nome nominal do tipo diverge.
            me = await new Api(token).getMe(controller.signal as unknown as Parameters<Api["getMe"]>[0]);
        } finally {
            clearTimeout(timer);
        }
        return { ok: true, botUsername: me!.username };
    } catch (error) {
        // grammy embrulha o erro da API do Telegram (401 = token inválido/revogado) — a mensagem já vem em português-friendly o bastante.
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `Não consegui validar o token com o Telegram: ${message}` };
    }
}
