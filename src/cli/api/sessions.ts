import { authed } from "./http.ts";

/** Espelha `GET /chat/sessions/summaries` e `GET /chat/sessions/:id/history` do backend-v2. */
export interface SessionSummary {
    id: string;
    createdAt: string;
    updatedAt: string;
    /** 1ª mensagem do dono (as sessões não têm título hoje). Vazia se a sessão nunca teve mensagem. */
    preview: string;
}

export interface HistoryEntry {
    id?: string;
    role: string;
    text: string;
    createdAt?: string;
}

export interface PaginatedHistory {
    entries: HistoryEntry[];
    total: number;
    limit: number;
    offset: number;
}

export function listSessionSummaries(baseUrl: string, token: string, limit = 30): Promise<SessionSummary[]> {
    return authed(baseUrl, token, "GET", `/chat/sessions/summaries?limit=${limit}`);
}

/** `offset` conta a partir da mensagem mais recente (offset 0 = as últimas `limit`); `entries` vem em ordem cronológica. */
export function getSessionHistory(baseUrl: string, token: string, sessionId: string, limit = 60, offset = 0): Promise<PaginatedHistory> {
    return authed(baseUrl, token, "GET", `/chat/sessions/${encodeURIComponent(sessionId)}/history?limit=${limit}&offset=${offset}`);
}

/** Apaga a conversa PERMANENTEMENTE (histórico + snapshot do Genkit no backend) — sem volta. */
export function deleteSession(baseUrl: string, token: string, sessionId: string): Promise<{ deleted: true }> {
    return authed(baseUrl, token, "DELETE", `/chat/sessions/${encodeURIComponent(sessionId)}`);
}

/** Apaga TODAS as conversas do dono de uma vez — sem volta. Devolve quantas apagou. */
export function clearSessions(baseUrl: string, token: string): Promise<{ deleted: number }> {
    return authed(baseUrl, token, "DELETE", "/chat/sessions");
}
