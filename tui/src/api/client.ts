import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChannelsSnapshot, ChatSessionSummary, DoctorReport, HistoryPage, SendMessageResult } from "./types.ts";

export const SUPPORTED_API_VERSION = 1;

/** Diretório de config da Helena — igual ao do daemon (client/src/local-api/paths.ts). */
export function configDir(): string {
    if (process.env.HELENA_CONFIG_DIR) return process.env.HELENA_CONFIG_DIR;
    if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "Helena");
    return path.join(os.homedir(), ".config", "helena");
}

/** Token local do daemon (arquivo 0600 criado no 1º boot dele). undefined = o daemon nunca subiu nesta máquina. */
export function readLocalToken(): string | undefined {
    if (process.env.HELENA_LOCAL_TOKEN) return process.env.HELENA_LOCAL_TOKEN;
    try {
        const token = fs.readFileSync(path.join(configDir(), "local-token"), "utf8").trim();
        return token.length >= 32 ? token : undefined;
    } catch {
        return undefined;
    }
}

export function defaultBaseUrl(): string {
    return process.env.HELENA_LOCAL_URL ?? `http://127.0.0.1:${process.env.CLIENT_LOCAL_PORT ?? process.env.CLIENT_PANEL_PORT ?? 4100}`;
}

export class LocalApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

export interface LocalApi {
    baseUrl: string;
    token: string;
    health(): Promise<{ status: string; version: string; apiVersion: number; session: { loggedIn: boolean } }>;
    sessionStatus(): Promise<{ loggedIn: boolean }>;
    login(email: string, password: string): Promise<{ user: { id: string; email: string; displayName?: string } }>;
    logout(): Promise<void>;
    sendMessage(text: string, sessionId?: string): Promise<SendMessageResult>;
    resolve(sessionId: string, tool: string, ref: string | undefined, approved: boolean): Promise<SendMessageResult>;
    sessions(): Promise<ChatSessionSummary[]>;
    history(sessionId: string, limit: number, offset: number): Promise<HistoryPage>;
    channels(): Promise<ChannelsSnapshot>;
    doctor(): Promise<DoctorReport>;
    /** Passagem autenticada a `/v1/backend/<path>` (contacts, billing, dashboard…). */
    backend<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
    /** Ação de canal: `POST /v1/channels/<canal>/<ação>`. */
    channelAction(channel: "whatsapp" | "telegram", action: "start" | "stop" | "logout"): Promise<void>;
}

export function createLocalApi(options: { baseUrl: string; token: string; fetchImpl?: typeof fetch }): LocalApi {
    const doFetch = options.fetchImpl ?? fetch;

    async function request<T>(method: string, route: string, body?: unknown): Promise<T> {
        let response: Response;
        try {
            response = await doFetch(`${options.baseUrl}${route}`, {
                method,
                headers: { Authorization: `Bearer ${options.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
                ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            });
        } catch (error) {
            throw new LocalApiError(0, "daemon_unreachable", `Daemon local não respondeu (${options.baseUrl}): ${error instanceof Error ? error.message : String(error)}`);
        }
        const text = await response.text();
        let parsed: unknown;
        try {
            parsed = text ? JSON.parse(text) : undefined;
        } catch {
            parsed = undefined;
        }
        if (!response.ok) {
            const b = (parsed ?? {}) as { message?: string | string[]; error?: string };
            const message = Array.isArray(b.message) ? b.message.join(" — ") : (b.message ?? (text || `HTTP ${response.status}`));
            throw new LocalApiError(response.status, b.error ?? `http_${response.status}`, message);
        }
        return parsed as T;
    }

    return {
        baseUrl: options.baseUrl,
        token: options.token,
        health: () => request("GET", "/health"),
        sessionStatus: () => request("GET", "/v1/session/status"),
        login: (email, password) => request("POST", "/v1/session/login", { email, password }),
        logout: async () => void (await request("POST", "/v1/session/logout")),
        sendMessage: (text, sessionId) => request("POST", "/v1/chat/messages", { text, ...(sessionId ? { sessionId } : {}) }),
        resolve: (sessionId, tool, ref, approved) => request("POST", `/v1/chat/sessions/${sessionId}/resolve`, { tool, ref, approved }),
        sessions: () => request("GET", "/v1/chat/sessions"),
        history: (sessionId, limit, offset) => request("GET", `/v1/chat/sessions/${sessionId}/history?limit=${limit}&offset=${offset}`),
        channels: () => request("GET", "/v1/channels"),
        doctor: () => request("GET", "/v1/doctor"),
        backend: (method, route, body) => request(method, `/v1/backend/${route.replace(/^\//, "")}`, body),
        channelAction: async (channel, action) => void (await request("POST", `/v1/channels/${channel}/${action}`)),
    };
}
