import { WebSocket } from "ws";
import type { EventHub } from "./event-hub.ts";

/**
 * UMA conexão com `/ws/chat-progress` do backend, repassada ao hub — N TUIs abertas não abrem N conexões
 * (hoje cada TUI abre a sua e reconecta sozinha). Reconexão com backoff exponencial aqui, no daemon.
 * Autentica com o token de dispositivo (longa duração) quando existir; o backend também aceita o JWT.
 */
export interface ProgressUpstreamOptions {
    backendUrl: string;
    hub: EventHub;
    getToken: () => string | undefined;
    minDelayMs?: number;
    maxDelayMs?: number;
}

export function startProgressUpstream(options: ProgressUpstreamOptions): { stop(): void } {
    const { hub } = options;
    const minDelay = options.minDelayMs ?? 1_000;
    const maxDelay = options.maxDelayMs ?? 30_000;
    let stopped = false;
    let attempt = 0;
    let socket: WebSocket | undefined;
    let timer: NodeJS.Timeout | undefined;

    function connect(): void {
        if (stopped) return;
        const token = options.getToken();
        if (!token) {
            hub.setState("backend", "unauth");
            timer = setTimeout(connect, minDelay * 5);
            return;
        }
        const url = `${options.backendUrl.replace(/^http/, "ws")}/ws/chat-progress?token=${encodeURIComponent(token)}`;
        socket = new WebSocket(url);
        socket.on("open", () => {
            attempt = 0;
            hub.setState("backend", "ok");
        });
        socket.on("message", (raw) => {
            try {
                const event = JSON.parse(String(raw)) as { type?: string };
                hub.publish("chat.progress", event);
                // eventos de fim de tarefa também viram tipos próprios (entram no buffer de "perdidos")
                if (event.type === "job_done") hub.publish(event.type, event);
            } catch {
                // frame inválido: ignora.
            }
        });
        const retry = () => {
            if (stopped) return;
            hub.setState("backend", "down");
            const delay = Math.min(maxDelay, minDelay * 2 ** attempt++);
            timer = setTimeout(connect, delay);
        };
        socket.on("close", retry);
        socket.on("error", () => socket?.terminate());
    }

    connect();
    return {
        stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
            socket?.terminate();
        },
    };
}
