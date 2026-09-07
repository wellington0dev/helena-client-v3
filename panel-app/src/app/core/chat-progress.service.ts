import { Injectable, inject, signal } from "@angular/core";
import { API_BASE_URL } from "./api-base.token";
import { AuthService } from "./auth.service";

export type ChatProgressEvent =
    | { type: "turn_start"; sessionId?: string; at: string }
    | { type: "tool_call"; sessionId?: string; tool: string; input?: unknown; at: string }
    | { type: "turn_end"; sessionId?: string; at: string }
    | { type: "turn_error"; sessionId?: string; message: string; at: string };

const RECONNECT_DELAY_MS = 3000;

/**
 * Consome `/ws/chat-progress` do backend-v2 (ver ChatProgressGateway lá) —
 * diferente de `ChannelsService` (que conecta no PRÓPRIO host do painel,
 * `/ws` local), aqui o destino é o backend-v2 REAL via `API_BASE_URL`, por
 * isso precisa reconectar sozinho se cair (é um host remoto de verdade,
 * não um processo local sempre no ar junto do painel).
 */
@Injectable({ providedIn: "root" })
export class ChatProgressService {
    private readonly apiBaseUrl = inject(API_BASE_URL);
    private readonly auth = inject(AuthService);

    readonly latest = signal<ChatProgressEvent | null>(null);

    private socket: WebSocket | null = null;

    constructor() {
        if (typeof window === "undefined") return;
        this.connect();
    }

    private connect(): void {
        const token = this.auth.token();
        if (!this.apiBaseUrl || !token) {
            setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
            return;
        }

        const wsUrl = `${this.apiBaseUrl.replace(/^http/, "ws")}/ws/chat-progress?token=${encodeURIComponent(token)}`;
        const socket = new WebSocket(wsUrl);
        this.socket = socket;

        socket.onmessage = (event) => this.latest.set(JSON.parse(event.data));
        socket.onclose = () => {
            if (this.socket === socket) setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
        };
        socket.onerror = () => socket.close();
    }
}
