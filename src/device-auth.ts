import { startTelegram } from "./channels/telegram.ts";
import { startWhatsapp } from "./channels/whatsapp.ts";
import { config } from "./config.ts";
import { saveDeviceToken } from "./device-token.ts";
import { startMachineAgent } from "./machine-agent.ts";

/**
 * Provisiona sozinho o token de longa duração desta máquina (WhatsApp/
 * Telegram/execução remota) a partir do PRIMEIRO JWT que aparecer —
 * painel ou `helena` CLI, tanto faz, ver panel/server.ts#handleCliSession
 * e cli/chat.ts. Idempotente: se `config.backendApiToken` já existe (seja
 * de um provisionamento anterior, seja de `BACKEND_V2_API_TOKEN` no
 * `.env` de quem configurou manualmente), não gera um token novo — nunca
 * acumula token órfão no backend-v2 a cada login.
 *
 * `startWhatsapp`/`startTelegram`/`startMachineAgent` já são seguras de
 * chamar de novo a qualquer momento (cada uma só olha `config.*` na hora
 * de rodar, não guarda estado de "já tentei antes") — a primeira chamada
 * em `main.ts`, sem token nenhum ainda, só reporta status "error" sem
 * criar recurso nenhum (sem socket, sem bot), então chamar de novo aqui,
 * já com o token pronto, é a ativação de verdade, não uma duplicata.
 */
export async function ensureDeviceToken(jwt: string): Promise<void> {
    if (config.backendApiToken) return;
    if (!config.backendUrl) return;

    try {
        const response = await fetch(`${config.backendUrl}/auth/api-tokens`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
            body: JSON.stringify({ label: "client (automático)" }),
        });
        if (!response.ok) {
            console.error(`[device-auth] falha ao provisionar token (${response.status}) — WhatsApp/Telegram/execução remota continuam desligados até o próximo login.`);
            return;
        }
        const { token } = (await response.json()) as { token: string };
        saveDeviceToken(token);
        config.backendApiToken = token;

        startWhatsapp();
        startTelegram();
        startMachineAgent(config.backendUrl, config.backendApiToken);
    } catch (err) {
        // Nunca lança — mesmo espírito de handleCliSession (best-effort, nunca bloqueia o login em si).
        console.error("[device-auth] falha ao provisionar token:", err);
    }
}
