import type { HubEvent } from "./types.ts";

export type EventsStatus = "connecting" | "open" | "closed";

export interface EventsConnection {
    close(): void;
}

/**
 * Conecta em `/v1/events` do daemon (WebSocket) com reconexão por backoff. O token vai no SUBPROTOCOLO
 * (`helena.bearer.<token>`), nunca na URL. Guarda o último id de evento e reconecta com `?since=` — o daemon
 * reenvia o que foi perdido (job_done, project_event, session.expired) marcado `replayed`.
 */
export function connectEvents(options: {
    baseUrl: string;
    token: string;
    onEvent: (event: HubEvent) => void;
    onStatus?: (status: EventsStatus) => void;
    WebSocketImpl?: typeof WebSocket;
    minDelayMs?: number;
    maxDelayMs?: number;
}): EventsConnection {
    const WS = options.WebSocketImpl ?? WebSocket;
    const minDelay = options.minDelayMs ?? 500;
    const maxDelay = options.maxDelayMs ?? 10_000;
    let closed = false;
    let attempt = 0;
    let lastId = 0;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function open(): void {
        if (closed) return;
        options.onStatus?.("connecting");
        const url = `${options.baseUrl.replace(/^http/, "ws")}/v1/events${lastId > 0 ? `?since=${lastId}` : ""}`;
        try {
            socket = new WS(url, [`helena.bearer.${options.token}`]);
        } catch {
            schedule();
            return;
        }
        socket.addEventListener("open", () => {
            attempt = 0;
            options.onStatus?.("open");
        });
        socket.addEventListener("message", (message) => {
            try {
                const event = JSON.parse(String(message.data)) as HubEvent;
                if (typeof event.id === "number" && event.id > lastId) lastId = event.id;
                options.onEvent(event);
            } catch {
                // frame inválido: ignora.
            }
        });
        socket.addEventListener("close", () => {
            options.onStatus?.("closed");
            schedule();
        });
        socket.addEventListener("error", () => socket?.close());
    }

    function schedule(): void {
        if (closed || timer) return;
        const delay = Math.min(maxDelay, minDelay * 2 ** attempt++);
        timer = setTimeout(() => {
            timer = undefined;
            open();
        }, delay);
    }

    open();
    return {
        close() {
            closed = true;
            if (timer) clearTimeout(timer);
            socket?.close();
        },
    };
}
