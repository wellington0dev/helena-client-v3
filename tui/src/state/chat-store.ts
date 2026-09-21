import type { HistoryEntry, HistoryPage, PendingConfirmation, SendMessageResult } from "../api/types.ts";

/**
 * Estado do chat como REDUCER PURO (sem React, sem rede) — testável direto. Duas regras de projeto vindas do
 * spike TUI-0: (1) o histórico é uma JANELA (no máximo MAX_ITEMS itens na tela; renderizar 10 mil elementos custou
 * 7 s de 1º desenho e 250–900 ms por tecla), e (2) o que ficou pra trás é buscado por página (`offset` do backend
 * conta a partir da mensagem mais recente).
 */
export const MAX_ITEMS = 400;
export const PAGE_SIZE = 100;

export type NoticeTone = "info" | "warn" | "error";

export type Item =
    | { kind: "user"; id: number; text: string; senderName?: string }
    | { kind: "assistant"; id: number; text: string }
    | { kind: "tool"; id: number; name: string; input?: unknown; output?: unknown }
    | { kind: "notice"; id: number; tone: NoticeTone; text: string }
    | { kind: "usage"; id: number; text: string };

export interface ChatState {
    sessionId?: string;
    items: Item[];
    /** Total de mensagens da conversa no backend (cresce a cada mensagem enviada). */
    total: number;
    busy: boolean;
    /** Texto do indicador ao vivo ("pensando…", "usando Bash(ls)"). */
    live?: string;
    pending: PendingConfirmation[];
    nextId: number;
}

export const initialChat: ChatState = { items: [], total: 0, busy: false, pending: [], nextId: 1 };

export type Action =
    | { type: "history_loaded"; sessionId: string; page: HistoryPage; prepend?: boolean }
    | { type: "user_sent"; text: string }
    | { type: "progress"; event: { type: string; tool?: string; input?: unknown; message?: string } }
    | { type: "turn_result"; result: SendMessageResult }
    | { type: "error"; message: string }
    | { type: "notice"; tone: NoticeTone; text: string }
    | { type: "reset" };

const TOOL_LABELS: Record<string, string> = { shell: "Bash", write_file: "Write", read_file: "Read", list_files: "List", search_files: "Search", exec_background: "Bash (bg)" };

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** `Bash(ls -la)` em vez do nome cru + JSON do input. */
export function toolLabel(name: string, input: unknown): string {
    const label = TOOL_LABELS[name] ?? name;
    const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
    const primary = typeof obj.command === "string" ? obj.command : typeof obj.path === "string" ? obj.path : undefined;
    if (primary) return `${label}(${truncate(primary, 60)})`;
    if (input === undefined || input === null) return label;
    let json = "";
    try {
        json = JSON.stringify(input);
    } catch {
        json = "";
    }
    return json && json !== "{}" ? `${label}(${truncate(json, 60)})` : label;
}

function fromEntry(entry: HistoryEntry, id: number): Item {
    return entry.role === "user" ? { kind: "user", id, text: entry.text, senderName: entry.senderName } : { kind: "assistant", id, text: entry.text };
}

type NewItem = Item extends infer T ? (T extends { id: number } ? Omit<T, "id"> : never) : never;

const isMessage = (item: Item) => item.kind === "user" || item.kind === "assistant";

function push(state: ChatState, ...added: NewItem[]): ChatState {
    let nextId = state.nextId;
    const items = [...state.items, ...added.map((a) => ({ ...a, id: nextId++ }) as Item)];
    // janela: descarta os mais antigos (voltam por paginação)
    return { ...state, items: items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items, nextId };
}

export function heldMessages(state: ChatState): number {
    return state.items.filter(isMessage).length;
}

/** Ainda existem mensagens mais antigas no backend do que as que estão na janela? */
export function hasOlder(state: ChatState): boolean {
    return Boolean(state.sessionId) && heldMessages(state) < state.total;
}

/** `offset` da próxima página de mensagens antigas (a partir da mais recente). */
export function olderOffset(state: ChatState): number {
    return heldMessages(state);
}

function usageLine(result: SendMessageResult): string | undefined {
    const u = result.usage;
    if (!u) return undefined;
    const parts: string[] = [];
    if (u.inputTokens !== undefined || u.outputTokens !== undefined) parts.push(`${u.inputTokens ?? 0} in · ${u.outputTokens ?? 0} out`);
    if (u.cachedTokens) parts.push(`${u.cachedTokens} em cache`);
    parts.push(`${(u.durationMs / 1000).toFixed(1)} s`);
    return parts.join(" · ");
}

export function chatReducer(state: ChatState, action: Action): ChatState {
    switch (action.type) {
        case "history_loaded": {
            let nextId = state.nextId;
            const loaded = action.page.entries.map((e) => fromEntry(e, nextId++));
            if (action.prepend && state.sessionId === action.sessionId) {
                const items = [...loaded, ...state.items];
                return { ...state, items: items.length > MAX_ITEMS ? items.slice(0, MAX_ITEMS) : items, total: action.page.total, nextId };
            }
            return { ...initialChat, sessionId: action.sessionId, items: loaded, total: action.page.total, nextId };
        }
        case "user_sent":
            return { ...push(state, { kind: "user", text: action.text }), total: state.total + 1, busy: true, live: "pensando…", pending: [] };
        case "progress": {
            const e = action.event;
            if (e.type === "turn_start") return { ...state, live: "pensando…" };
            if (e.type === "tool_call") return { ...state, live: `usando ${toolLabel(e.tool ?? "tool", e.input)}` };
            if (e.type === "turn_end") return { ...state, live: undefined };
            if (e.type === "turn_error") return { ...push(state, { kind: "notice", tone: "error", text: e.message ?? "erro no turno" }), live: undefined };
            return state;
        }
        case "turn_result": {
            const r = action.result;
            let next: ChatState = { ...state, sessionId: r.sessionId, busy: false, live: undefined, pending: r.pending ?? [] };
            for (const t of r.toolActivity ?? []) next = push(next, { kind: "tool", name: t.name, input: t.input, output: t.output });
            if (r.text) next = { ...push(next, { kind: "assistant", text: r.text }), total: next.total + 1 };
            const usage = usageLine(r);
            if (usage) next = push(next, { kind: "usage", text: usage });
            return next;
        }
        case "error":
            return { ...push(state, { kind: "notice", tone: "error", text: action.message }), busy: false, live: undefined };
        case "notice":
            return push(state, { kind: "notice", tone: action.tone, text: action.text });
        case "reset":
            return { ...initialChat, nextId: state.nextId };
    }
}
