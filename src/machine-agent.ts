import os from "node:os";
import { runCommand } from "./local-shell.ts";
import { updateMachineAgent } from "./panel/status-bus.ts";

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

type AgentClientMessage = AgentRegisterMessage | AgentExecResultMessage;

interface AgentExecRequest {
    type: "exec";
    requestId: string;
    capability: string;
    payload: unknown;
}

const RECONNECT_DELAY_MS = 5_000;

/**
 * Única capability implementada no backend-v2 hoje (device/network/gh/
 * browser/file-transfer eram do backend single-owner, não portadas — ver
 * docs/architecture-v2.md §6). Fixa, sem env var pra configurar — YAGNI
 * enquanto só existir uma.
 */
const CAPABILITIES = ["shell"];

async function handleExec(message: AgentExecRequest): Promise<AgentClientMessage> {
    try {
        if (message.capability !== "shell") {
            // Não deveria acontecer — o backend só manda capacidades que
            // este cliente declarou ter no register. Defensivo.
            return { type: "exec-result", requestId: message.requestId, ok: false, error: `capability desconhecida: "${message.capability}"` };
        }
        const { command, cwd } = message.payload as { command: string; cwd?: string };
        const result = await runCommand(command, cwd);
        return { type: "exec-result", requestId: message.requestId, ok: true, result };
    } catch (err) {
        return { type: "exec-result", requestId: message.requestId, ok: false, error: err instanceof Error ? err.message : String(err) };
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

        socket.addEventListener("message", async (event) => {
            let message: AgentExecRequest;
            try {
                message = JSON.parse(String(event.data));
            } catch {
                return;
            }
            if (message.type === "exec") socket.send(JSON.stringify(await handleExec(message)));
        });

        socket.addEventListener("close", () => {
            updateMachineAgent({ status: "connecting", machineName });
            setTimeout(connect, RECONNECT_DELAY_MS);
        });

        socket.addEventListener("error", (event) => {
            console.error("[machine-agent] erro de conexão:", (event as ErrorEvent).message ?? event);
        });
    }

    connect();
}
