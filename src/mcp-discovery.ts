import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface DiscoveredMcpServer { name: string; serverUrl: string; source: string; transport: "stdio" | "http" }
type LocalConfig = { command?: unknown; args?: unknown; env?: unknown; cwd?: unknown; url?: unknown; type?: unknown; headers?: unknown };

function sources(home = os.homedir(), platform = process.platform): Record<string, string> {
    const config = platform === "win32" ? path.join(home, "AppData", "Roaming") : platform === "darwin" ? path.join(home, "Library", "Application Support") : path.join(home, ".config");
    return {
        claude: path.join(config, "Claude", "claude_desktop_config.json"),
        cursor: path.join(home, ".cursor", "mcp.json"),
        vscode: path.join(config, "Code", "User", "mcp.json"),
        helena: path.join(config, "helena", "mcp.json"),
    };
}

async function readServers(file: string): Promise<Record<string, LocalConfig>> {
    try {
        const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const obj = parsed as Record<string, unknown>;
        const entries = obj.mcpServers ?? obj.servers;
        return entries && typeof entries === "object" && !Array.isArray(entries) ? entries as Record<string, LocalConfig> : {};
    } catch { return {}; }
}

export async function discoverMcpServers(home?: string, platform?: NodeJS.Platform): Promise<DiscoveredMcpServer[]> {
    const found: DiscoveredMcpServer[] = [];
    for (const [source, file] of Object.entries(sources(home, platform))) {
        for (const [name, config] of Object.entries(await readServers(file))) {
            if (!config || typeof config !== "object" || !name || name.length > 150) continue;
            if (typeof config.command === "string" && config.command.trim()) {
                found.push({ name, source, transport: "stdio", serverUrl: `stdio://${source}/${encodeURIComponent(name)}` });
            } else if (typeof config.url === "string" && !config.headers) {
                try {
                    const url = new URL(config.url);
                    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash)
                        found.push({ name, source, transport: "http", serverUrl: url.href });
                } catch { /* configuração inválida */ }
            }
        }
    }
    return found;
}

export async function resolveStdioServer(reference: string, home?: string, platform?: NodeJS.Platform): Promise<{ command: string; args?: string[]; env?: Record<string, string>; cwd?: string }> {
    const url = new URL(reference);
    const file = sources(home, platform)[url.hostname];
    if (url.protocol !== "stdio:" || !file || url.search || url.hash || !url.pathname.startsWith("/")) throw new Error("Referência MCP local inválida.");
    const name = decodeURIComponent(url.pathname.slice(1));
    const servers = await readServers(file);
    const entry = Object.hasOwn(servers, name) ? servers[name] : undefined;
    if (!entry || typeof entry.command !== "string" || !entry.command.trim()) throw new Error("Servidor MCP local não encontrado na configuração.");
    if (entry.args !== undefined && (!Array.isArray(entry.args) || entry.args.some((v) => typeof v !== "string"))) throw new Error("Argumentos MCP inválidos.");
    if (entry.env !== undefined && (!entry.env || typeof entry.env !== "object" || Array.isArray(entry.env) || Object.values(entry.env).some((v) => typeof v !== "string"))) throw new Error("Ambiente MCP inválido.");
    if (entry.cwd !== undefined && typeof entry.cwd !== "string") throw new Error("Diretório MCP inválido.");
    return { command: entry.command, args: entry.args as string[] | undefined, env: entry.env as Record<string, string> | undefined, cwd: entry.cwd as string | undefined };
}
