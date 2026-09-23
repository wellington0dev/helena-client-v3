import { authed } from "./http.ts";

/**
 * Espelha `panel-app/src/app/core/mcp-connections.service.ts` — mesmo
 * protocolo REST (`backend-v2/src/mcp-connections/mcp-connections.controller.ts`).
 * O token de autenticação do servidor MCP NUNCA volta em claro — só
 * `hasAuthToken` (booleano). Ao editar, deixar `authToken` de fora mantém
 * o token já salvo (não existe jeito de "limpar" o token separadamente
 * de trocar por outro).
 */
export interface McpConnectionSummary {
    id: string;
    name: string;
    serverUrl: string;
    hasAuthToken: boolean;
    enabled: boolean;
    /** Ausente = backend conecta DIRETO no serverUrl (exige destino público). Setado = essa máquina do dono conecta de verdade — único jeito de um MCP em localhost/rede privada funcionar (2026-09-22, ver docs/agent-team-architecture.md e ssrf-guard.ts). */
    machine?: string;
    createdAt: string;
    updatedAt: string;
}

export interface McpConnectionInput {
    name: string;
    serverUrl: string;
    authToken?: string;
    enabled?: boolean;
    machine?: string;
}

export function listMcpConnections(baseUrl: string, token: string): Promise<McpConnectionSummary[]> {
    return authed(baseUrl, token, "GET", "/mcp-connections");
}

export function createMcpConnection(baseUrl: string, token: string, input: McpConnectionInput): Promise<McpConnectionSummary> {
    return authed(baseUrl, token, "POST", "/mcp-connections", input);
}

/** `machine: null` limpa (volta a conectar direto pelo backend) — diferente de omitir, que mantém o que já estava. */
export function updateMcpConnection(baseUrl: string, token: string, id: string, patch: Partial<Omit<McpConnectionInput, "machine">> & { machine?: string | null }): Promise<McpConnectionSummary> {
    return authed(baseUrl, token, "PATCH", `/mcp-connections/${id}`, patch);
}

export function deleteMcpConnection(baseUrl: string, token: string, id: string): Promise<{ deleted: true }> {
    return authed(baseUrl, token, "DELETE", `/mcp-connections/${id}`);
}
