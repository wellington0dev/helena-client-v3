import { Api, Bot, InputFile, type Context } from "grammy";
import { hydrateFiles, type FileFlavor } from "@grammyjs/files";
import { config } from "../config.ts";
import { updateTelegram } from "../local-api/status-bus.ts";
import { sendGroupInboundMessage, sendInboundMessage } from "./backend-client.ts";
import { exceedsMediaLimit, mediaTooLargeMessage } from "./media-limit.ts";
import { toTelegramHtml } from "./markdown-format.ts";
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

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
    if (!currentBot) throw new Error("Telegram não está conectado.");
    await currentBot.api.sendMessage(chatId, toTelegramHtml(text), { parse_mode: "HTML" });
}

/** Mesmo formato aceito no reply de um turno normal (ver handlePrivateMessage) — usado tanto ali quanto pelo outbound-poller (message_contact com stickerId). */
export async function sendTelegramSticker(chatId: string, base64: string): Promise<void> {
    if (!currentBot) throw new Error("Telegram não está conectado.");
    await currentBot.api.sendSticker(chatId, new InputFile(Buffer.from(base64, "base64")));
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
    if (!text && !photo && !stickerMsg) return; // outra mídia (áudio/vídeo/documento): fora de escopo desta leva, ignora silenciosamente.
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

        const result = await sendInboundMessage(config.backendUrl, config.backendApiToken, {
            channel: "telegram",
            contactId: String(ctx.from.id),
            senderName: ctx.from.first_name || undefined,
            text,
            image,
            sticker,
        });
        if ("blocked" in result) return;

        await ctx.reply(toTelegramHtml(result.text), { parse_mode: "HTML" });
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
        const result = await sendGroupInboundMessage(config.backendUrl, config.backendApiToken, {
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

export function startTelegram(): void {
    if (!config.backendUrl || !config.backendApiToken) {
        updateTelegram({ status: "error", error: "BACKEND_V2_URL/BACKEND_V2_API_TOKEN não configurados no .env." });
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
