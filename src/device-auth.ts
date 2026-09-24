import { startTelegram } from "./channels/telegram.ts";
import { startWhatsapp } from "./channels/whatsapp.ts";
import { config } from "./config.ts";
import { readStoredDeviceToken, saveDeviceToken } from "./device-token.ts";
import { startMachineAgent } from "./machine-agent.ts";
import { captureError } from "./telemetry.ts";

/** `sub` do JWT (id do usuário) sem verificar assinatura — só decide SE precisa provisionar; quem valida o JWT de verdade é o backend no `POST /auth/api-tokens`. */
export function jwtSubject(jwt: string): string | undefined {
    try {
        const payload = jwt.split(".")[1];
        if (!payload) return undefined;
        const sub = (JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown }).sub;
        return typeof sub === "string" && sub ? sub : undefined;
    } catch {
        return undefined;
    }
}

let inflight: Promise<void> | undefined;

/**
 * Garante que o token de longa duração desta máquina (WhatsApp/Telegram/execução remota) é da conta que acabou de
 * logar — painel ou `helena` CLI, ver local-api/server.ts (`/cli-session`) e cli/chat.ts#notifyLocalDaemon. Também
 * roda na subida do daemon com a sessão já salva (main.ts), então quem já estava logado não precisa relogar.
 *
 * Mantém o token atual SÓ quando `device-token.json` diz que ele é deste mesmo usuário. Qualquer outro caso
 * provisiona um novo pra conta logada e reconecta tudo: token de outra conta, arquivo antigo sem `userId`, ou
 * `BACKEND_V2_API_TOKEN` do `.env` (dono desconhecido). Bug real (2026-09-24): o `.env` tinha um token do admin
 * de seed, e o antigo `if (config.backendApiToken) return` fazia o login do dono nunca vincular a máquina. Ela
 * registrava "veronica" na conta errada e a Helena respondia "nenhuma máquina conectada". Em produção o usuário
 * nem sabe o que é variável de ambiente: o login TEM que bastar.
 */
export function ensureDeviceToken(jwt: string, activate: () => void = activateWithNewToken): Promise<void> {
    // Dois logins quase simultâneos (painel + CLI) nunca provisionam dois tokens.
    inflight ??= provision(jwt, activate).finally(() => {
        inflight = undefined;
    });
    return inflight;
}

/** Liga os canais e REINICIA o agente da máquina (fecha a conexão com o token antigo) — ver startMachineAgent. Injetável só pros testes nunca subirem WhatsApp/Telegram/WebSocket de verdade. */
function activateWithNewToken(): void {
    startWhatsapp();
    startTelegram();
    startMachineAgent(config.backendUrl, config.backendApiToken);
}

async function provision(jwt: string, activate: () => void): Promise<void> {
    if (!config.backendUrl) return;
    const userId = jwtSubject(jwt);
    if (!userId) return;

    const stored = readStoredDeviceToken();
    if (config.backendApiToken && stored?.userId === userId && stored.token === config.backendApiToken) return;

    try {
        const response = await fetch(`${config.backendUrl}/auth/api-tokens`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
            body: JSON.stringify({ label: "client (automático)" }),
        });
        if (!response.ok) {
            captureError("device-auth", `falha ao provisionar token (${response.status}) — WhatsApp/Telegram/execução remota seguem com o token anterior (se houver) até o próximo login.`);
            return;
        }
        const { token } = (await response.json()) as { token: string };
        saveDeviceToken(token, userId);
        config.backendApiToken = token;
        activate();
    } catch (err) {
        // Nunca lança — best-effort, nunca bloqueia o login em si.
        captureError("device-auth", "falha ao provisionar token", err);
    }
}
