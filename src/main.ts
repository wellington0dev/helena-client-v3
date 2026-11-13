import os from "node:os";
import path from "node:path";
import { applyFileConfig, config } from "./config.ts";
import { loadFileConfig, patchFileConfig, publicView } from "./local-api/config-store.ts";
import { runDoctor } from "./local-api/doctor.ts";
import { hardenPermissions } from "./local-api/harden.ts";
import { configDir } from "./local-api/paths.ts";
import fs from "node:fs";
import { configureBackendSession } from "./backend-session.ts";
import { createEventHub } from "./local-api/event-hub.ts";
import { loadOrCreateLocalToken } from "./local-api/local-token.ts";
import { startProgressUpstream } from "./local-api/progress-upstream.ts";
import { startLocalApi } from "./local-api/server.ts";
import { createSessionManager } from "./local-api/session-manager.ts";
import { clearSession, loadSession, saveSession } from "./cli/session-store.ts";
import { getState, onStateChange } from "./local-api/status-bus.ts";
import { logoutWhatsapp, startWhatsapp, stopWhatsapp } from "./channels/whatsapp.ts";
import { startTelegram, stopTelegram, validateTelegramToken } from "./channels/telegram.ts";
import { startMachineAgent, stopMachineAgent } from "./machine-agent.ts";
import { startOutboundPoller } from "./outbound-poller.ts";
import { captureError, reportError } from "./telemetry.ts";
import { startMachineMetrics } from "./machine-metrics.ts";
import { startMcpServer, stopMcpServer } from "./mcp-server.ts";

/**
 * Entrypoint único do client/ — sobe o servidor local SEMPRE (mesmo sem
 * nenhum canal configurado ainda; expõe `/health`, `/cli-session` e o WS
 * `/ws` de status — ver `local-api/server.ts`), tenta os canais, registra
 * esta máquina como executora de comando (absorve o antigo `helena agent`
 * do cli/ — ver machine-agent.ts), e inicia o poller de saída (mensagens
 * que o backend-v2 precisa entregar por iniciativa própria — ver
 * outbound-poller.ts). Um processo só: os endpoints locais precisam ver o
 * estado de tudo isso, e o poller de saída depende dos canais já
 * estarem conectados pra entregar.
 *
 * O painel web (Angular) que rodava em cima deste mesmo servidor foi
 * DESABILITADO (2026-09-17) — a CLI (`helena`) é a interface principal
 * agora; ver `client/docs/local-server-api.md`.
 *
 * MCP Server (novo): se `CLIENT_MCP_SERVER=1` no .env, também sobe o
 * MCP server via stdio expondo capacidades locais de ARQUIVO (list/read/
 * search/grep/glob/write/preview) pra clientes MCP externos conectarem.
 * `shell`/`delete_file` foram removidos de propósito (2026-09-28) — ver
 * o comentário no topo de mcp-server.ts.
 */
// API local (`/v1`): o daemon é o hub — a TUI fala só com ele. Ver docs/local-api.md.
const hub = createEventHub();
hub.setState("channels", getState());
onStateChange((state) => hub.setState("channels", { ...state }));
let session: ReturnType<typeof createSessionManager>;
let clientRuntimeActive = false;
function startClientRuntime(): void {
    if (clientRuntimeActive || !session?.isLoggedIn()) return;
    clientRuntimeActive = true;
    startWhatsapp();
    startTelegram();
    startMachineAgent(config.backendUrl, () => session.getAccessToken());
}
function stopClientRuntime(): void {
    clientRuntimeActive = false;
    void stopWhatsapp();
    void stopTelegram();
    stopMachineAgent();
}
session = createSessionManager({
    backendUrl: () => config.backendUrl,
    store: { load: loadSession, save: saveSession, clear: clearSession },
    hub,
    onLogin: () => startClientRuntime(),
    onLogout: stopClientRuntime,
    deviceLabel: config.machineName || os.hostname(),
});
configureBackendSession((path, init) => session.authedFetch(path, init));
const version = (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const secretPaths = [configDir(), path.resolve(config.whatsappAuthDir), path.resolve(config.whatsappLidPinsFile)];

// Config central e permissões de segredos locais.
const { fixed } = hardenPermissions(secretPaths);
if (fixed.length > 0) console.log(`[segurança] permissões endurecidas em ${fixed.length} item(ns) de segredo.`);

startLocalApi({
    port: config.localPort,
    host: config.localBind,
    version,
    localToken: loadOrCreateLocalToken(),
    session,
    hub,
    machineName: config.machineName || os.hostname(),
    channels: {
        info: () => ({ telegramTokenSet: Boolean(config.telegramBotToken) }),
        whatsapp: {
            start() { if (!session.isLoggedIn()) throw new Error("Faça login para conectar o WhatsApp."); startWhatsapp(); },
            stop: stopWhatsapp,
            logout: logoutWhatsapp,
        },
        telegram: {
            start() { if (!session.isLoggedIn()) throw new Error("Faça login para conectar o Telegram."); startTelegram(); },
            stop: stopTelegram,
            async setToken(token) {
                if (token !== "") {
                    const checked = await validateTelegramToken(token);
                    if (!checked.ok) return { ok: false, error: checked.error };
                }
                const result = patchFileConfig({ telegramBotToken: token === "" ? null : token });
                if (!result.ok) return { ok: false, error: Object.values(result.errors).join("; ") };
                if (token === "") config.telegramBotToken = "";
                applyFileConfig();
                void stopTelegram().then(() => { if (session.isLoggedIn()) startTelegram(); });
                return { ok: true };
            },
        },
    },
    configApi: {
        get: () => ({ file: publicView(loadFileConfig()), effective: { backendUrl: config.backendUrl, machineName: config.machineName || os.hostname(), allowedDirs: config.allowedDirs, deniedPaths: config.deniedPaths, backgroundShellTimeoutMinutes: config.backgroundShellTimeoutMinutes, mediaMaxMb: config.mediaMaxMb } }),
        patch(patch) {
            const result = patchFileConfig(patch);
            if (!result.ok) return result;
            applyFileConfig();
            return { ok: true, config: publicView(result.config), changed: result.changed, restartRequired: result.restartRequired };
        },
    },
    machine: () => ({ name: config.machineName || os.hostname(), hostname: os.hostname(), platform: process.platform, agent: hub.snapshot().channels ? (hub.snapshot().channels as { machineAgent?: unknown }).machineAgent : undefined }),
    doctor: () => runDoctor({ backendUrl: config.backendUrl, session, hub, secretPaths, listenHost: config.localBind, version }),
});
startProgressUpstream({ backendUrl: config.backendUrl, hub, getToken: () => session.getAccessToken() });
void session.getAccessToken().then((accessToken) => { if (accessToken) startClientRuntime(); });
startOutboundPoller(() => session.isLoggedIn());
startMachineMetrics();

// MCP Server opcional (via env var)
if (config.mcpServerEnabled) {
    startMcpServer().catch((err) => captureError("mcp-server", "falha ao iniciar", err));
}

/**
 * Único ponto de captura de erro NÃO tratado do processo inteiro (ver
 * telemetry.ts) — cobre qualquer coisa que escapou de um catch específico
 * em qualquer canal/módulo, sem precisar espalhar reportError em cada
 * arquivo. Nunca chama process.exit aqui: um WhatsApp/Telegram flakiness
 * já teria seu próprio catch; isto é só a rede de segurança final.
 */
process.on("uncaughtException", (err) => reportError(err, "client:uncaughtException"));
process.on("unhandledRejection", (reason) => reportError(reason, "client:unhandledRejection"));

/**
 * `systemctl restart` (rodado pelo update.sh a cada atualização) manda
 * SIGTERM — sem este handler, o Node mata o processo na hora, podendo
 * interromper uma gravação de credencial do WhatsApp no meio (ver
 * stopWhatsapp em channels/whatsapp.ts) e deixar a sessão desvinculada.
 * Timeout de segurança: nunca deixa o shutdown travar pra sempre se algo
 * demorar mais que isso.
 */
const SHUTDOWN_TIMEOUT_MS = 5000;

async function shutdown(): Promise<void> {
    await Promise.race([stopWhatsapp().catch((error) => captureError("main", "falha ao encerrar WhatsApp", error, "warn")), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))]);
    await stopMcpServer().catch(() => undefined);
    process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
