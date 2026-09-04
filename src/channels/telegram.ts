import { Bot, type Context } from "grammy";
import { hydrateFiles, type FileFlavor } from "@grammyjs/files";
import { config } from "../config.ts";
import { updateTelegram } from "../panel/status-bus.ts";
import { sendGroupInboundMessage, sendInboundMessage } from "./backend-client.ts";
import { exceedsMediaLimit, mediaTooLargeMessage } from "./media-limit.ts";
import { toTelegramHtml } from "./markdown-format.ts";

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

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
    if (!currentBot) throw new Error("Telegram não está conectado.");
    await currentBot.api.sendMessage(chatId, toTelegramHtml(text), { parse_mode: "HTML" });
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
    if (!text && !photo) return; // outra mídia (áudio/vídeo/documento): fora de escopo desta leva, ignora silenciosamente.
    if (!ctx.from) return;

    try {
        if (photo && exceedsMediaLimit(photo[photo.length - 1]!.file_size)) {
            await ctx.reply(mediaTooLargeMessage());
            return;
        }

        const image = photo
            ? { mimeType: "image/jpeg", base64: Buffer.from(await (await fetch((await ctx.getFile()).getUrl())).arrayBuffer()).toString("base64"), caption: ctx.message?.caption }
            : undefined;

        const result = await sendInboundMessage(config.backendUrl, config.backendApiToken, {
            channel: "telegram",
            contactId: String(ctx.from.id),
            senderName: ctx.from.first_name || undefined,
            text,
            image,
        });
        if ("blocked" in result) return;

        await ctx.reply(toTelegramHtml(result.text), { parse_mode: "HTML" });
    } catch (error) {
        console.error("[telegram] falha ao processar mensagem:", error);
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
        console.error("[telegram] falha ao processar mensagem de grupo:", error);
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

    updateTelegram({ status: "connecting" });

    const bot = new Bot<TelegramContext>(config.telegramBotToken);
    bot.api.config.use(hydrateFiles(bot.token));

    bot.catch((error) => {
        console.error("[telegram] erro não tratado:", error);
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
