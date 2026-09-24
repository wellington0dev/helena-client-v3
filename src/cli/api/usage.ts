import { authed } from "./http.ts";

/** Espelha `panel-app/src/app/core/dashboard.service.ts` — `GET /dashboard/usage` (ver `backend-v2/docs/rest-api-reference.md`). Só CONTAGEM de chamadas, não tokens/R$ (isso é `api/billing.ts`). */
export interface UsageSummary {
    totalCalls: number;
    firstCallAt?: string;
    lastCallAt?: string;
    callsByChannel: Record<string, number>;
    callsByDay: { date: string; calls: number }[];
}

export function getUsage(baseUrl: string, token: string): Promise<UsageSummary> {
    return authed(baseUrl, token, "GET", "/dashboard/usage");
}

/** Uma mensagem no histórico de gastos — `GET /dashboard/usage/messages` (backend-v2 UsageLogService#messagesForUser). */
export interface UsageMessage {
    at: string;
    sessionId: string | null;
    inputTokens: number;
    cachedTokens: number;
    outputTokens: number;
    thoughtsTokens: number;
    /** `null` = mensagem anterior a 2026-09-24, quando o custo ainda não era registrado. */
    costBrl: number | null;
}

export interface UsageMessages {
    messages: UsageMessage[];
    sessionCostBrl: number | null;
    todayCostBrl: number;
}

export function getUsageMessages(baseUrl: string, token: string, opts: { sessionId?: string; limit?: number } = {}): Promise<UsageMessages> {
    const params = new URLSearchParams();
    if (opts.sessionId) params.set("sessionId", opts.sessionId);
    if (opts.limit) params.set("limit", String(opts.limit));
    const query = params.toString();
    return authed(baseUrl, token, "GET", `/dashboard/usage/messages${query ? `?${query}` : ""}`);
}
