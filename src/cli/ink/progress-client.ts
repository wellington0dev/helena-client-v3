/**
 * Consome `/ws/chat-progress` do backend-v2 (ver ChatProgressGateway lá) —
 * mesmo shape de evento que panel-app/src/app/core/chat-progress.service.ts
 * consome do lado do painel. Usa o `WebSocket` global do Node (nativo desde
 * o Node 22, sem depender do pacote `ws`).
 */

/** Livre desde a dinamização de papéis no backend-v2 (§14 do doc de arquitetura) — só "architect"/"designer"/"qa" têm significado especial; qualquer outro rótulo pode ter sido inventado na hora pela Helena/Arquiteta. */
export type ProjectStepRole = string;
export type ProjectStepStatus = "ready" | "running" | "done" | "failed";

export type ChatProgressEvent =
    | { type: "turn_start"; sessionId?: string; at: string }
    | { type: "tool_call"; sessionId?: string; tool: string; input?: unknown; at: string }
    | { type: "turn_end"; sessionId?: string; at: string }
    | { type: "turn_error"; sessionId?: string; message: string; at: string }
    /** Conclusão de um comando `shell` rodado com `background:true` — ver ShellJobNotifierService no backend-v2. */
    | { type: "job_done"; jobId: string; ok: boolean; summary: string; at: string }
    /** Marco de um Project da equipe de dev (pausou, concluiu) — ver ProjectEventNotifierService no backend-v2. */
    | { type: "project_event"; projectId: string; kind: string; summary: string; at: string }
    /** Progresso de UM step (mudou de status) — ver ProjectStepProgressNotifierService no backend-v2. */
    | { type: "project_step"; projectId: string; role: ProjectStepRole; status: ProjectStepStatus; at: string };

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
