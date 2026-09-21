import { useCallback, useReducer, useRef } from "react";
import { LocalApiError, type LocalApi } from "../api/client.ts";
import type { HubEvent } from "../api/types.ts";
import { chatReducer, hasOlder, initialChat, olderOffset, PAGE_SIZE, type ChatState } from "../state/chat-store.ts";

export interface ChatController {
    state: ChatState;
    loadSession(sessionId: string): Promise<void>;
    loadOlder(): Promise<void>;
    send(text: string): Promise<void>;
    resolve(approved: boolean): Promise<void>;
    newSession(): void;
    notice(tone: "info" | "warn" | "error", text: string): void;
    handleHubEvent(event: HubEvent): void;
}

/** Liga o reducer puro à API local. Nunca lança: erros viram avisos na conversa. */
export function useChat(api: LocalApi): ChatController {
    const [state, dispatch] = useReducer(chatReducer, initialChat);
    const ref = useRef(state);
    ref.current = state;
    const loadingOlder = useRef(false);

    const fail = useCallback((error: unknown) => {
        const message = error instanceof LocalApiError ? (error.status === 401 ? "Sessão expirada — entre de novo." : error.message) : String(error);
        dispatch({ type: "error", message });
    }, []);

    return {
        state,
        async loadSession(sessionId) {
            try {
                const page = await api.history(sessionId, PAGE_SIZE, 0);
                dispatch({ type: "history_loaded", sessionId, page });
            } catch (e) {
                fail(e);
            }
        },
        async loadOlder() {
            const s = ref.current;
            if (!s.sessionId || !hasOlder(s) || loadingOlder.current) return;
            loadingOlder.current = true;
            try {
                const page = await api.history(s.sessionId, PAGE_SIZE, olderOffset(s));
                dispatch({ type: "history_loaded", sessionId: s.sessionId, page, prepend: true });
            } catch (e) {
                fail(e);
            } finally {
                loadingOlder.current = false;
            }
        },
        async send(text) {
            dispatch({ type: "user_sent", text });
            try {
                dispatch({ type: "turn_result", result: await api.sendMessage(text, ref.current.sessionId) });
            } catch (e) {
                fail(e);
            }
        },
        async resolve(approved) {
            const s = ref.current;
            const p = s.pending[0];
            if (!s.sessionId || !p) return;
            dispatch({ type: "progress", event: { type: "turn_start" } });
            try {
                dispatch({ type: "turn_result", result: await api.resolve(s.sessionId, p.tool, p.ref, approved) });
            } catch (e) {
                fail(e);
            }
        },
        newSession: () => dispatch({ type: "reset" }),
        notice: (tone, text) => dispatch({ type: "notice", tone, text }),
        handleHubEvent(event) {
            if (event.type === "chat.progress") dispatch({ type: "progress", event: event.data as { type: string } });
            else if (event.type === "job_done") {
                const d = event.data as { ok?: boolean; summary?: string };
                dispatch({ type: "notice", tone: d.ok === false ? "warn" : "info", text: `${event.replayed ? "(enquanto você estava fora) " : ""}Comando em segundo plano terminou: ${d.summary ?? ""}` });
            } else if (event.type === "project_event") {
                const d = event.data as { summary?: string };
                dispatch({ type: "notice", tone: "info", text: `${event.replayed ? "(enquanto você estava fora) " : ""}Projeto: ${d.summary ?? ""}` });
            }
        },
    };
}
