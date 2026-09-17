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
