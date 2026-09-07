import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

/** Espelha McpConnectionSummary do backend-v2 (mcp-connections.service.ts) — o token nunca vem aqui, só `hasAuthToken`. */
export interface McpConnectionSummary {
    id: string;
    name: string;
    serverUrl: string;
    hasAuthToken: boolean;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface CreateMcpConnectionInput {
    name: string;
    serverUrl: string;
    authToken?: string;
    enabled?: boolean;
}

/** Tudo opcional — PATCH parcial, mesmo contrato do backend. `authToken` ausente = mantém o token já guardado. */
export interface UpdateMcpConnectionInput {
    name?: string;
    serverUrl?: string;
    authToken?: string;
    enabled?: boolean;
}

@Injectable({ providedIn: "root" })
export class McpConnectionsService {
    private readonly http = inject(HttpClient);

    list(): Promise<McpConnectionSummary[]> {
        return firstValueFrom(this.http.get<McpConnectionSummary[]>("/mcp-connections"));
    }

    create(input: CreateMcpConnectionInput): Promise<McpConnectionSummary> {
        return firstValueFrom(this.http.post<McpConnectionSummary>("/mcp-connections", input));
    }

    update(id: string, input: UpdateMcpConnectionInput): Promise<McpConnectionSummary> {
        return firstValueFrom(this.http.patch<McpConnectionSummary>(`/mcp-connections/${id}`, input));
    }

    async delete(id: string): Promise<boolean> {
        const res = await firstValueFrom(this.http.delete<{ deleted: boolean }>(`/mcp-connections/${id}`));
        return res.deleted;
    }
}
