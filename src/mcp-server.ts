import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { config } from "./config.ts";
import { deleteFile, globFiles, grepFiles, listFiles, previewDiff, readFile, searchFiles, writeFile, type FileEdit } from "./local-files.ts";
import { runCommand, type StreamCallbacks } from "./local-shell.ts";
import { captureError } from "./telemetry.ts";

/**
 * MCP Server que expõe as capacidades locais do client/ (shell, file ops, etc)
 * pra clientes MCP externos poderem conectar e usar.
 *
 * Roda no MESMO processo do client/ (main.ts), expondo via stdio.
 * Clientes MCP externos conectam via stdio (ex: `helena mcp-server`).
 */

// Mapeia capabilities locais pra tools MCP
const MCP_TOOLS: Tool[] = [
    {
        name: "shell",
        description: "Executa um comando shell na máquina local. Use para rodar comandos, scripts, builds, etc.",
        inputSchema: {
            type: "object",
            properties: {
                command: { type: "string", description: "Comando a executar" },
                cwd: { type: "string", description: "Diretório de trabalho (opcional)" },
                background: { type: "boolean", description: "Se true, roda em background e devolve jobId" },
            },
            required: ["command"],
        },
    },
    {
        name: "list_files",
        description: "Lista arquivos em um diretório",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Diretório a listar" },
                pattern: { type: "string", description: "Regex opcional para filtrar nomes" },
            },
            required: ["path"],
        },
    },
    {
        name: "read_file",
        description: "Lê o conteúdo de um arquivo",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Caminho do arquivo" },
            },
            required: ["path"],
        },
    },
    {
        name: "search_files",
        description: "Busca arquivos por nome e/ou conteúdo",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Diretório raiz" },
                namePattern: { type: "string", description: "Regex opcional para nome do arquivo" },
                contentPattern: { type: "string", description: "Regex opcional para conteúdo" },
            },
            required: ["path"],
        },
    },
    {
        name: "grep_files",
        description: "Busca regex no conteúdo de arquivos",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Diretório raiz" },
                pattern: { type: "string", description: "Regex a buscar" },
                filePattern: { type: "string", description: "Regex opcional para filtrar arquivos" },
            },
            required: ["path", "pattern"],
        },
    },
    {
        name: "glob_files",
        description: "Encontra arquivos por padrão glob",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Diretório raiz" },
                pattern: { type: "string", description: "Padrão glob (ex: **/*.ts)" },
            },
            required: ["path", "pattern"],
        },
    },
    {
        name: "write_file",
        description: "Escreve/edita arquivo com edits estruturados (add/remove/replace_all)",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Caminho do arquivo" },
                edits: {
                    type: "array",
                    items: {
                        type: "object",
                        oneOf: [
                            { type: "object", properties: { type: { const: "add" }, startLine: { type: "number" }, content: { type: "string" } }, required: ["type", "startLine", "content"] },
                            { type: "object", properties: { type: { const: "remove" }, startLine: { type: "number" }, endLine: { type: "number" } }, required: ["type", "startLine", "endLine"] },
                            { type: "object", properties: { type: { const: "replace_all" }, content: { type: "string" } }, required: ["type", "content"] },
                        ],
                    },
                    description: "Edits estruturados (mesmo formato do write_file local)",
                },
            },
            required: ["path", "edits"],
        },
    },
    {
        name: "delete_file",
        description: "Apaga um arquivo",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Caminho do arquivo" },
            },
            required: ["path"],
        },
    },
    {
        name: "preview_diff",
        description: "Gera diff unificado (git diff) das edições sem aplicar",
        inputSchema: {
            type: "object",
            properties: {
                path: { type: "string", description: "Caminho do arquivo" },
                edits: {
                    type: "array",
                    items: {
                        type: "object",
                        oneOf: [
                            { type: "object", properties: { type: { const: "add" }, startLine: { type: "number" }, content: { type: "string" } }, required: ["type", "startLine", "content"] },
                            { type: "object", properties: { type: { const: "remove" }, startLine: { type: "number" }, endLine: { type: "number" } }, required: ["type", "startLine", "endLine"] },
                            { type: "object", properties: { type: { const: "replace_all" }, content: { type: "string" } }, required: ["type", "content"] },
                        ],
                    },
                    description: "Edits para preview",
                },
            },
            required: ["path", "edits"],
        },
    },
];

function createMcpServer(): Server {
    const server = new Server(
        {
            name: "helena-client",
            version: "0.1.0",
        },
        {
            capabilities: {
                tools: {},
            },
        },
    );

    // List tools
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        console.error("[MCP Server] tools/list handler called");
        return { tools: MCP_TOOLS };
    });

    // Call tool
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        console.error("[MCP Server] call tool:", request.params?.name);
        const { name, arguments: args } = request.params;

        try {
            switch (name) {
                case "shell": {
                    const { command, cwd, background } = args as { command: string; cwd?: string; background?: boolean };
                    if (background) {
                        // Para background, usa runCommandInternal com callback vazio
                        const result = await runCommand(command, cwd);
                        return { content: [{ type: "text", text: JSON.stringify({ jobId: "bg-" + Date.now(), status: "started" }) }] };
                    }
                    const result = await runCommand(command, cwd);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                case "list_files": {
                    const { path, pattern } = args as { path: string; pattern?: string };
                    const result = listFiles(path, pattern);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                case "read_file": {
                    const { path } = args as { path: string };
                    const result = readFile(path);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                case "search_files": {
                    const { path, namePattern, contentPattern } = args as { path: string; namePattern?: string; contentPattern?: string };
                    const result = searchFiles(path, namePattern, contentPattern);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                case "grep_files": {
                    const { path, pattern, filePattern } = args as { path: string; pattern: string; filePattern?: string };
                    const result = grepFiles(path, pattern, filePattern);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                case "glob_files": {
                    const { path, pattern } = args as { path: string; pattern: string };
                    const result = globFiles(path, pattern);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                case "write_file": {
                    const { path, edits } = args as { path: string; edits: FileEdit[] };
                    const result = writeFile(path, edits);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                case "delete_file": {
                    const { path } = args as { path: string };
                    const result = deleteFile(path);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                case "preview_diff": {
                    const { path, edits } = args as { path: string; edits: FileEdit[] };
                    const result = previewDiff(path, edits);
                    return { content: [{ type: "text", text: JSON.stringify(result) }] };
                }

                default:
                    throw new Error(`Tool desconhecida: ${name}`);
            }
        } catch (err) {
            return {
                content: [{ type: "text", text: `Erro: ${err instanceof Error ? err.message : String(err)}` }],
                isError: true,
            };
        }
    });

    return server;
}

let mcpServer: Server | null = null;

/**
 * Inicia o MCP server via stdio.
 * Bloqueia até o server fechar.
 */
export async function startMcpServer(): Promise<void> {
    const server = createMcpServer();
    mcpServer = server;

    const transport = new StdioServerTransport();
    console.error("[MCP Server] conectando transporte...");
    
    transport.onmessage = (msg) => {
        console.error("[MCP Server] Received message:", JSON.stringify(msg));
    };
    
    transport.onclose = () => {
        console.error("[MCP Server] Transport closed");
    };
    
    transport.onerror = (err) => {
        captureError("mcp-server", "erro no transporte stdio", err);
    };
    
    await server.connect(transport);
    console.error("[MCP Server] rodando via stdio");
    console.error("[MCP Server] aguardando mensagens no stdin...");

    // Add close handler
    process.stdin.on("close", () => {
        console.error("[MCP Server] stdin closed");
    });
    process.stdin.on("error", (err) => {
        captureError("mcp-server", "erro no stdin", err);
    });
    process.stdout.on("error", (err) => {
        captureError("mcp-server", "erro no stdout", err);
    });

    // Keep the process alive - wait indefinitely
    await new Promise(() => {});
}

// Auto-start when run directly (e.g., `node src/mcp-server.ts` or `helena mcp-server`)
if (import.meta.url === `file://${process.argv[1]}`) {
    startMcpServer().catch((err) => {
        captureError("mcp-server", "falha ao iniciar", err);
        // dá 2 s pro relato sair antes de morrer (fetch best-effort, nunca segura mais que isso).
        setTimeout(() => process.exit(1), 2000).unref();
    });
}

/**
 * Para o MCP server graciosamente.
 */
export async function stopMcpServer(): Promise<void> {
    if (mcpServer) {
        await mcpServer.close();
        mcpServer = null;
    }
}