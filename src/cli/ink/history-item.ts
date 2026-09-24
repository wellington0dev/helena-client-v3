
/**
 * Tipo + construtores do histórico do chat, extraídos de `app.ts` pra
 * módulo próprio — `viewport.ts` (medição de altura, pra caber no
 * fullscreen) precisa do tipo `HistoryItem`, e `app.ts` importa de
 * `viewport.ts`. Sem este módulo intermediário o import seria circular
 * (mesmo motivo do `Screen` em commands.ts).
 */
export type HistoryItem =
    | { id: string; role: "user" | "assistant"; text: string }
    /** Chamada de tool — aparece na hora (ver ChatProgressEvent#tool_call), padrão Claude Code: `● Bash(comando)`. Nunca é editada depois de criada — o resultado, quando existir, é uma entrada NOVA (tool_result), nunca uma mutação desta. */
    | { id: string; role: "tool_call"; name: string; input: unknown }
    /** Resultado de UMA tool — só existe depois que o turno inteiro termina (`SendMessageResult#toolActivity`, ver backend.ts), então sempre aparece em lote, depois de todas as chamadas ao vivo do mesmo turno — nunca intercalado 1-a-1 (o Agent Beta do Genkit não expõe resultado durante o streaming, só no fim). */
    | { id: string; role: "tool_result"; name: string; output: unknown }
    /** Aviso empurrado FORA de qualquer turno de chat em andamento — conclusão de shell em segundo plano (ver ChatProgressEvent#job_done). Nunca gated por "sending": pode chegar a qualquer momento, mesmo sem o dono ter mandado nada agora. */
    | { id: string; role: "notice"; text: string; tone: "success" | "warn" | "danger" | "info" };
// Custo/tokens por mensagem saíram do chat (era um item "usage" embaixo de cada resposta) e foram pra sidebar,
// bloco "Gastos" (2026-09-24, pedido do dono) — ver sidebar-spending.ts.

let nextId = 0;
export function historyItem(role: "user" | "assistant", text: string): HistoryItem {
    return { id: `h${nextId++}`, role, text };
}
export function toolCallItem(name: string, input: unknown): HistoryItem {
    return { id: `h${nextId++}`, role: "tool_call", name, input };
}
export function toolResultItem(name: string, output: unknown): HistoryItem {
    return { id: `h${nextId++}`, role: "tool_result", name, output };
}
export function noticeItem(text: string, tone: "success" | "warn" | "danger" | "info"): HistoryItem {
    return { id: `h${nextId++}`, role: "notice", text, tone };
}
