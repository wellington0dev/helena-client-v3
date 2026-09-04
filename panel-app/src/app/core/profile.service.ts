import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export interface ApiTokenSummary {
    id: string;
    label?: string;
    createdAt: string;
    lastUsedAt?: string | null;
}

export interface CreatedApiToken extends ApiTokenSummary {
    /** Só vem nesta resposta, uma vez — nunca mais recuperável depois. */
    token: string;
}

export interface UsageSummary {
    totalCalls: number;
    firstCallAt: string | null;
    lastCallAt: string | null;
    callsByChannel: Record<string, number>;
    /** A API só devolve dias com pelo menos uma chamada — quem consome preenche os dias vazios (ver ChatComponent/ProfileComponent). */
    callsByDay: { date: string; calls: number }[];
}

@Injectable({ providedIn: "root" })
export class ProfileService {
    private readonly http = inject(HttpClient);

    usage(): Promise<UsageSummary> {
        return firstValueFrom(this.http.get<UsageSummary>("/dashboard/usage"));
    }

    listApiTokens(): Promise<ApiTokenSummary[]> {
        return firstValueFrom(this.http.get<ApiTokenSummary[]>("/auth/api-tokens"));
    }

    createApiToken(label?: string): Promise<CreatedApiToken> {
        return firstValueFrom(this.http.post<CreatedApiToken>("/auth/api-tokens", { label }));
    }

    async revokeApiToken(id: string): Promise<boolean> {
        const res = await firstValueFrom(this.http.delete<{ revoked: boolean }>(`/auth/api-tokens/${id}`));
        return res.revoked;
    }
}
