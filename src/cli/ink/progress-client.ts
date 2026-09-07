/**
 * Consome `/ws/chat-progress` do backend-v2 (ver ChatProgressGateway lá) —
 * mesmo shape de evento que panel-app/src/app/core/chat-progress.service.ts
 * consome do lado do painel. Usa o `WebSocket` global do Node (nativo desde
 * o Node 22, sem depender do pacote `ws`).
 */

export type ChatProgressEvent =
    | { type: "turn_start"; sessionId?: string; at: string }
    | { type: "tool_call"; sessionId?: string; tool: string; input?: unknown; at: string }
    | { type: "turn_end"; sessionId?: string; at: string }
    | { type: "turn_error"; sessionId?: string; message: string; at: string };

/** Conecta uma vez e chama `onEvent` pra cada evento — nunca lança (falha de conexão só significa "sem indicador ao vivo", o chat continua funcionando via REST normalmente). Devolve uma função pra fechar a conexão. */
export function connectProgress(backendUrl: string, token: string, onEvent: (event: ChatProgressEvent) => void): () => void {
    const wsUrl = `${backendUrl.replace(/^http/, "ws")}/ws/chat-progress?token=${encodeURIComponent(token)}`;
    let closed = false;
    let socket: WebSocket | undefined;

    try {
        socket = new WebSocket(wsUrl);
        socket.addEventListener("message", (event) => {
            try {
                onEvent(JSON.parse(event.data.toString()));
            } catch {
                // Evento malformado — ignora, nunca derruba o CLI por isso.
            }
        });
        socket.addEventListener("error", () => socket?.close());
    } catch {
        // Sem indicador ao vivo — o chat continua funcionando via REST puro.
    }

    return () => {
        if (closed) return;
        closed = true;
        socket?.close();
    };
}
