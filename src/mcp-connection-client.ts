import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Cliente MCP DE VERDADE, rodando aqui no `client/` (2026-09-22, pedido do dono: "não seria melhor a conexão com o
 * mcp ocorrer através do cliente?") — mesmo motivo de `shell`/`write_file` já rodarem por aqui e nunca no
 * backend-v2: quando o servidor MCP mora na MESMA máquina (ou rede) do dono, é o `client/` quem consegue alcançar
 * `localhost`/IP privado sem cruzar fronteira nenhuma — o backend-v2 nunca poderia, e nem deveria (guard de SSRF,
 * ver backend-v2/src/common/ssrf-guard.ts, auditoria S4). O backend continua conectando DIRETO em servidor MCP
 * público (não precisa de máquina nenhuma pra isso) — isto aqui só cobre o caminho "roteado por uma máquina"
 * (`McpConnection.machine` setado), acionado via as capabilities `mcp_list_tools`/`mcp_call_tool` (ver
 * machine-agent.ts). Conecta/fecha uma sessão POR CHAMADA (sem cache) — simplicidade antes de otimizar; MCP local é
 * rápido o bastante pra isso não doer.
 */

const LIST_TOOLS_TIMEOUT_MS = 8000;
const CALL_TOOL_TIMEOUT_MS = 20_000;

export interface McpToolDescriptor {
    name: string;
    description?: string;
    inputSchema: unknown;
}

async function connect(serverUrl: string, authToken?: string): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
        ...(authToken && { requestInit: { headers: { Authorization: `Bearer ${authToken}` } } }),
    });
    const client = new Client({ name: "helena-machine-agent", version: "1.0.0" });
    await client.connect(transport);
    return client;
}

/** Lista as tools do servidor MCP local — usado pra montar o catálogo de tools do lado do backend-v2 (ver mcp-client-registry.service.ts). Segue paginação (`nextCursor`) até esgotar, mesmo padrão de `@genkit-ai/mcp`. */
export async function mcpListTools(serverUrl: string, authToken?: string): Promise<{ tools: McpToolDescriptor[] }> {
    const client = await connect(serverUrl, authToken);
    try {
        const tools: McpToolDescriptor[] = [];
        let cursor: string | undefined;
        do {
            const page = await client.listTools({ cursor }, { timeout: LIST_TOOLS_TIMEOUT_MS });
            tools.push(...page.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })));
            cursor = page.nextCursor;
        } while (cursor);
        return { tools };
    } finally {
        await client.close().catch(() => undefined);
    }
}

/** Chama UMA tool do servidor MCP local — devolve o `CallToolResult` CRU (content/isError/structuredContent), o backend-v2 é quem sabe interpretar isso do mesmo jeito que já faz pra conexão direta (ver processMcpResult em mcp-client-registry.service.ts). */
export async function mcpCallTool(serverUrl: string, authToken: string | undefined, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await connect(serverUrl, authToken);
    try {
        return await client.callTool({ name: toolName, arguments: args }, undefined, { timeout: CALL_TOOL_TIMEOUT_MS });
    } finally {
        await client.close().catch(() => undefined);
    }
}
