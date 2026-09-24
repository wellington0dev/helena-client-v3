/**
 * Consome `/ws/chat-progress` do backend-v2 (ver ChatProgressGateway lá) —
 * mesmo shape de evento que panel-app/src/app/core/chat-progress.service.ts
 * consome do lado do painel. Usa o `WebSocket` global do Node (nativo desde
 * o Node 22, sem depender do pacote `ws`).
 */

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "failed" | "cancelled";

export interface PlanStep {
    id: string;
    title: string;
    description?: string;
    status: PlanStepStatus;
    startedAt?: string;
    completedAt?: string;
    error?: string;
}

export interface AgentPlan {
    id: string;
    title: string;
    description: string;
    status: "active" | "completed" | "archived";
    steps: PlanStep[];
    sessionId?: string;
    createdAt: string;
    updatedAt: string;
}

export type ChatProgressEvent =
    | { type: "turn_start"; sessionId?: string; at: string }
    | { type: "tool_call"; sessionId?: string; tool: string; input?: unknown; at: string }
    | { type: "tool_stream"; sessionId?: string; tool: string; stdoutChunk?: string; stderrChunk?: string; at: string }
    | { type: "turn_end"; sessionId?: string; at: string }
    | { type: "turn_error"; sessionId?: string; message: string; at: string }
    /** Conclusão de um comando `shell` rodado com `background:true` — ver ShellJobNotifierService no backend-v2. */
    | { type: "job_done"; jobId: string; ok: boolean; summary: string; at: string }
    /** Plano do agent criado/atualizado — permite painel visual no TUI. */
    | { type: "plan_created"; plan: AgentPlan; at: string }
    | { type: "plan_updated"; planId: string; stepId: string; step: PlanStep | undefined; at: string }
    | { type: "plan_status_changed"; planId: string; status: AgentPlan["status"]; at: string };

export interface ProgressHub {
    /** Devolve uma função pra cancelar SÓ esta inscrição — a conexão em si continua aberta pra outros assinantes. */
    subscribe(onEvent: (event: ChatProgressEvent) => void): () => void;
    /** Fecha a conexão de verdade — só quem CRIOU o hub (ver `app.ts`) deve chamar isto, nunca um assinante avulso. */
    close(): void;
}

/**
 * Conecta UMA VEZ e devolve um hub multi-assinante — `app.ts` cria a
 * conexão (uma só, no topo) e telas específicas (ex: detalhe de um
 * Project) assinam os MESMOS eventos sem abrir outro WebSocket. Nunca
 * lança — falha de conexão só significa "sem indicador ao vivo", o chat
 * continua funcionando via REST normalmente.
 */
export function connectProgress(backendUrl: string, token: string): ProgressHub {
    const wsUrl = `${backendUrl.replace(/^http/, "ws")}/ws/chat-progress?token=${encodeURIComponent(token)}`;
    const listeners = new Set<(event: ChatProgressEvent) => void>();
    let closed = false;
    let socket: WebSocket | undefined;

    try {
        socket = new WebSocket(wsUrl);
        socket.addEventListener("message", (event) => {
            let parsed: ChatProgressEvent;
            try {
                parsed = JSON.parse(event.data.toString());
            } catch {
                return; // Evento malformado — ignora, nunca derruba o CLI por isso.
            }
            for (const listener of listeners) listener(parsed);
        });
        socket.addEventListener("error", () => socket?.close());
    } catch {
        // Sem indicador ao vivo — o chat continua funcionando via REST puro.
    }

    return {
        subscribe(onEvent) {
            listeners.add(onEvent);
            return () => listeners.delete(onEvent);
        },
        close() {
            if (closed) return;
            closed = true;
            listeners.clear();
            socket?.close();
        },
    };
}
