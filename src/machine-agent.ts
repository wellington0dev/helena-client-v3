import os from "node:os";
import { config } from "./config.ts";
import { deleteFile, globFiles, grepFiles, listFiles, previewDiff, readFile, searchFiles, writeFile, type FileEdit } from "./local-files.ts";
import { runCommand, runCommandInternal, type StreamCallbacks } from "./local-shell.ts";
import { updateMachineAgent } from "./panel/status-bus.ts";
import { reportTelemetry } from "./telemetry.ts";

/**
 * Protocolo de `/ws/agent` no backend-v2 — mesmo shape de
 * backend-v2/src/machines/agent-protocol.ts. Cópia própria de propósito
 * (contrato comum é docs/client-protocol.md, não um módulo TS
 * compartilhado — client/ e backend-v2 são repositórios separados agora).
 */
const PROTOCOL_VERSION = 1;

interface AgentRegisterMessage {
    type: "register";
    protocolVersion: number;
    machineName: string;
    capabilities: string[];
    platform?: NodeJS.Platform;
}

interface AgentExecResultMessage {
    type: "exec-result";
    requestId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
}

interface AgentExecProgressMessage {
    type: "exec-progress";
    requestId: string;
    stdoutChunk?: string;
    stderrChunk?: string;
}

interface AgentExecBackgroundResultMessage {
    type: "exec-background-result";
    jobId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
}

type AgentClientMessage = AgentRegisterMessage | AgentExecResultMessage | AgentExecProgressMessage | AgentExecBackgroundResultMessage;

interface AgentExecRequest {
    type: "exec";
    requestId: string;
    capability: string;
    payload: unknown;
    /** Se true, o cliente DEVE emitir `exec-progress` eventos durante a execução (streaming). */
    stream?: boolean;
}

/**
 * Fire-and-forget — tratado SEM `await` no loop de mensagem principal
 * (ver o listener "message" abaixo), senão travaria o socket pra
 * qualquer outra coisa (inclusive um `exec` síncrono normal) enquanto o
 * comando em segundo plano roda, potencialmente minutos.
 */
interface AgentExecBackgroundRequest {
    type: "exec-background";
    jobId: string;
    capability: string;
    payload: unknown;
}

type AgentServerEvent = AgentExecRequest | AgentExecBackgroundRequest;

const RECONNECT_DELAY_MS = 5_000;
const TIMEOUT_MS = 30_000;

/**
 * `shell`/`exec-background` são do backend-v2 desde o início; `list_files`/
 * `read_file`/`search_files`/`write_file`/`grep_files`/`glob_files` são a Fase 0 do plano de agentes
 * de dev (backend-v2 `docs/agent-team-architecture.md` §1.2) — leitura/
 * escrita estruturada, nunca via heredoc de shell. `device`/`network`/`gh`/
 * `browser`/`file-transfer` eram do backend single-owner, não portadas
 * (ver docs/architecture-v2.md §6) — `git`/`gh` não precisam de capability
 * própria, já rodam via `shell` (ver o mesmo §1.2). `delete_file` é só pra
 * `undo_last_write` desfazer um write que CRIOU um arquivo (sem pré-imagem
 * pra restaurar) — nunca uma tool exposta direto ao modelo (ver
 * local-files.ts). Fixa, sem env var pra configurar — YAGNI enquanto o
 * conjunto não mudar por tenant.
 */
const CAPABILITIES = ["shell", "list_files", "read_file", "search_files", "write_file", "delete_file", "grep_files", "glob_files", "preview_diff"];

/** As capabilities de arquivo são síncronas e locais (sem I/O de rede) — cabem no mesmo `exec`/`exec-result` de sempre, sem precisar do caminho `exec-background`. */
function dispatchCapability(capability: string, payload: unknown): unknown {
    switch (capability) {
        case "list_files": {
            const { path, pattern } = payload as { path: string; pattern?: string };
            return listFiles(path, pattern);
        }
        case "read_file": {
            const { path } = payload as { path: string };
            return readFile(path);
        }
        case "search_files": {
            const { path, namePattern, contentPattern } = payload as { path: string; namePattern?: string; contentPattern?: string };
            return searchFiles(path, namePattern, contentPattern);
        }
        case "grep_files": {
            const { path, pattern, filePattern } = payload as { path: string; pattern: string; filePattern?: string };
            return grepFiles(path, pattern, filePattern);
        }
        case "glob_files": {
            const { path, pattern } = payload as { path: string; pattern: string };
            return globFiles(path, pattern);
        }
        case "write_file": {
            const { path, edits } = payload as { path: string; edits: FileEdit[] };
            return writeFile(path, edits);
        }
        case "delete_file": {
            const { path } = payload as { path: string };
            return deleteFile(path);
        }
        case "preview_diff": {
            const { path, edits } = payload as { path: string; edits: FileEdit[] };
            return previewDiff(path, edits);
        }
        default:
            throw new Error(`capability desconhecida: "${capability}"`);
    }
}

async function handleExec(message: AgentExecRequest, socket: WebSocket): Promise<AgentClientMessage> {
    try {
        if (message.capability === "shell") {
            const { command, cwd } = message.payload as { command: string; cwd?: string };
            const shouldStream = message.stream === true;

            if (shouldStream) {
                // Streaming mode: emit progress events during execution
                const callbacks: StreamCallbacks = {
                    onStdoutChunk: (chunk) => {
                        if (socket.readyState === socket.OPEN) {
                            socket.send(JSON.stringify({
                                type: "exec-progress",
                                requestId: message.requestId,
                                stdoutChunk: chunk,
                            } satisfies AgentExecProgressMessage));
                        }
                    },
                    onStderrChunk: (chunk) => {
                        if (socket.readyState === socket.OPEN) {
                            socket.send(JSON.stringify({
                                type: "exec-progress",
                                requestId: message.requestId,
                                stderrChunk: chunk,
                            } satisfies AgentExecProgressMessage));
                        }
                    },
                };
                const result = await runCommandInternal(command, cwd, TIMEOUT_MS, callbacks);
                return { type: "exec-result", requestId: message.requestId, ok: true, result };
            }

            const result = await runCommand(command, cwd);
            return { type: "exec-result", requestId: message.requestId, ok: true, result };
        }
        return { type: "exec-result", requestId: message.requestId, ok: true, result: dispatchCapability(message.capability, message.payload) };
    } catch (err) {
        return { type: "exec-result", requestId: message.requestId, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/** Mesma lógica de `handleExec`, mas com o teto de tempo bem maior de `config.backgroundShellTimeoutMinutes` — quem chama NUNCA dá `await` nisto no loop de mensagem principal (ver listener "message" abaixo). */
async function handleExecBackground(message: AgentExecBackgroundRequest): Promise<AgentClientMessage> {
    try {
        if (message.capability !== "shell") {
            return { type: "exec-background-result", jobId: message.jobId, ok: false, error: `capability desconhecida: "${message.capability}"` };
        }
        const { command, cwd } = message.payload as { command: string; cwd?: string };
        const result = await runCommand(command, cwd, config.backgroundShellTimeoutMinutes * 60_000);
        return { type: "exec-background-result", jobId: message.jobId, ok: true, result };
    } catch (err) {
        return { type: "exec-background-result", jobId: message.jobId, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * client/ absorve aqui o papel do antigo `helena agent` (cli/) — a MESMA
 * máquina que bridgeia WhatsApp/Telegram/painel também vira executora de
 * comando, sem precisar de um segundo processo à parte. Nome da máquina é
 * sempre `os.hostname()` (determinístico, sem configuração — é o mesmo
 * valor que o `helena` CLI calcula pra mandar como `machineName` no
 * contexto de chat, ver chat.controller.ts#cwd/machineName).
 */
export function startMachineAgent(backendUrl: string, apiToken: string): void {
    if (!backendUrl || !apiToken) {
        updateMachineAgent({ status: "error", error: "BACKEND_V2_URL/BACKEND_V2_API_TOKEN não configurados no .env." });
        return;
    }

    const machineName = os.hostname();
    const backendWsUrl = backendUrl.replace(/^http/, "ws");

    function connect(): void {
        updateMachineAgent({ status: "connecting", machineName, error: undefined });
        // Token por query string (não `Sec-WebSocket-Protocol`) — ver
        // machines.gateway.ts no backend-v2.
        const socket = new WebSocket(`${backendWsUrl}/ws/agent?token=${encodeURIComponent(apiToken)}`);

        socket.addEventListener("open", () => {
            console.log(`[machine-agent] conectado a ${backendWsUrl} como "${machineName}" (capacidades: ${CAPABILITIES.join(", ")}).`);
            updateMachineAgent({ status: "connected", machineName, error: undefined });
            socket.send(
                JSON.stringify({
                    type: "register",
                    protocolVersion: PROTOCOL_VERSION,
                    machineName,
                    capabilities: CAPABILITIES,
                    platform: process.platform,
                } satisfies AgentRegisterMessage),
            );
        });

        socket.addEventListener("message", (event) => {
            let message: AgentServerEvent;
            try {
                message = JSON.parse(String(event.data));
            } catch {
                return;
            }
            if (message.type === "exec") {
                handleExec(message, socket).then((response) => socket.send(JSON.stringify(response)));
                return;
            }
            if (message.type === "exec-background") {
                // SEM await de propósito — um comando em segundo plano pode
                // levar minutos; esperar aqui travaria este loop pra
                // qualquer outra mensagem (inclusive um "exec" síncrono
                // normal) enquanto ele roda.
                handleExecBackground(message).then((response) => socket.send(JSON.stringify(response)));
            }
        });

        socket.addEventListener("close", () => {
            updateMachineAgent({ status: "connecting", machineName });
            setTimeout(connect, RECONNECT_DELAY_MS);
        });

        socket.addEventListener("error", (event) => {
            const message = (event as ErrorEvent).message ?? String(event);
            console.error("[machine-agent] erro de conexão:", message);
            void reportTelemetry("warn", `machine-agent: erro de conexão WS — ${message}`, { source: "machine-agent" });
        });
    }

    connect();
}
