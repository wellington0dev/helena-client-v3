import { readLocalToken } from "../../local-api/local-token.ts";

/**
 * Cliente HTTP do daemon LOCAL (`local-api/server.ts`, `/v1/...`) — a CLI e o daemon são o mesmo pacote na mesma máquina,
 * então falam por loopback com o token local (arquivo 0600), sem passar pelo backend-v2. Usado pelas ações de canais
 * (WhatsApp/Telegram moram no daemon, não no backend). Nunca imprime nem loga o token nem o corpo enviado (pode ser o token do bot).
 */
export class DaemonUnavailableError extends Error {}

const TIMEOUT_MS = 30_000;

async function call<T>(localPort: number, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    const token = readLocalToken();
    if (!token) throw new DaemonUnavailableError("Daemon local não encontrado nesta máquina (sem token local). Suba o serviço do client.");
    let response: Response;
    try {
        response = await fetch(`http://127.0.0.1:${localPort}${path}`, {
            method,
            headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
            ...(body !== undefined && { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });
    } catch {
        throw new DaemonUnavailableError(`O daemon local não respondeu na porta ${localPort}.`);
    }
    const raw = await response.text();
    let parsed: unknown;
    try {
        parsed = raw ? JSON.parse(raw) : {};
    } catch {
        parsed = {};
    }
    if (!response.ok) {
        const message = (parsed as { message?: unknown }).message;
        throw new Error(typeof message === "string" && message ? message : `O daemon respondeu HTTP ${response.status}.`);
    }
    return parsed as T;
}

export interface ChannelsInfo {
    whatsapp: { status: string; error?: string };
    telegram: { status: string; error?: string; tokenSet?: boolean };
    machineAgent?: { status: string; error?: string };
}

export const daemon = {
    channels: (port: number) => call<ChannelsInfo>(port, "GET", "/v1/channels"),
    whatsappStart: (port: number) => call<unknown>(port, "POST", "/v1/channels/whatsapp/start"),
    whatsappStop: (port: number) => call<unknown>(port, "POST", "/v1/channels/whatsapp/stop"),
    /** Apaga a sessão local do WhatsApp (o próximo `start` pede um QR novo). */
    whatsappLogout: (port: number) => call<unknown>(port, "POST", "/v1/channels/whatsapp/logout"),
    telegramStart: (port: number) => call<unknown>(port, "POST", "/v1/channels/telegram/start"),
    telegramStop: (port: number) => call<unknown>(port, "POST", "/v1/channels/telegram/stop"),
    setTelegramToken: (port: number, token: string) => call<unknown>(port, "PUT", "/v1/channels/telegram/token", { token }),
    removeTelegramToken: (port: number) => call<unknown>(port, "DELETE", "/v1/channels/telegram/token"),
};
