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
    createdAt: string;
    updatedAt: string;
}

export interface McpConnectionInput {
    name: string;
    serverUrl: string;
    authToken?: string;
    enabled?: boolean;
}

export function listMcpConnections(baseUrl: string, token: string): Promise<McpConnectionSummary[]> {
    return authed(baseUrl, token, "GET", "/mcp-connections");
}

export function createMcpConnection(baseUrl: string, token: string, input: McpConnectionInput): Promise<McpConnectionSummary> {
    return authed(baseUrl, token, "POST", "/mcp-connections", input);
}

export function updateMcpConnection(baseUrl: string, token: string, id: string, patch: Partial<McpConnectionInput>): Promise<McpConnectionSummary> {
    return authed(baseUrl, token, "PATCH", `/mcp-connections/${id}`, patch);
}

export function deleteMcpConnection(baseUrl: string, token: string, id: string): Promise<{ deleted: true }> {
    return authed(baseUrl, token, "DELETE", `/mcp-connections/${id}`);
}
