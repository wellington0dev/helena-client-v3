import os from "node:os";
import path from "node:path";
import { applyFileConfig, config } from "./config.ts";
import { importEnvOnce, loadFileConfig, patchFileConfig, publicView } from "./local-api/config-store.ts";
import { runDoctor } from "./local-api/doctor.ts";
import { hardenPermissions } from "./local-api/harden.ts";
import { configDir } from "./local-api/paths.ts";
import fs from "node:fs";
import { ensureDeviceToken } from "./device-auth.ts";
import { createEventHub } from "./local-api/event-hub.ts";
import { loadOrCreateLocalToken } from "./local-api/local-token.ts";
import { startProgressUpstream } from "./local-api/progress-upstream.ts";
import { startLocalApi } from "./local-api/server.ts";
import { createSessionManager } from "./local-api/session-manager.ts";
import { clearSession, loadSession, saveSession } from "./cli/session-store.ts";
import { getState, onStateChange } from "./local-api/status-bus.ts";
import { logoutWhatsapp, startWhatsapp, stopWhatsapp } from "./channels/whatsapp.ts";
import { startTelegram, stopTelegram, validateTelegramToken } from "./channels/telegram.ts";
import { startMachineAgent } from "./machine-agent.ts";
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
 * MCP server via stdio expondo capacidades locais (shell, file ops, etc)
 * pra clientes MCP externos conectarem.
 */
// API local (`/v1`): o daemon é o hub — a TUI fala só com ele. Ver docs/local-api.md.
const hub = createEventHub();
hub.setState("channels", getState());
onStateChange((state) => hub.setState("channels", { ...state }));
const session = createSessionManager({
    backendUrl: config.backendUrl,
    store: { load: loadSession, save: saveSession, clear: clearSession },
    hub,
    onLogin: ensureDeviceToken,
    deviceLabel: config.machineName || os.hostname(),
});
const version = (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
const clientDir = path.resolve(new URL("..", import.meta.url).pathname);
const secretPaths = [configDir(), path.join(clientDir, ".env"), path.resolve(config.whatsappAuthDir), path.resolve(config.whatsappLidPinsFile)];

// Config central: importa o .env UMA vez e endurece permissões de segredos (achado C5 da auditoria).
const imported = importEnvOnce();
if (imported.imported.length > 0) {
    applyFileConfig();
    console.log(`[config] importado do .env para ${configDir()}/config.json: ${imported.imported.join(", ")} (o .env segue como fallback)`);
}
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
        whatsapp: { start: startWhatsapp, stop: stopWhatsapp, logout: logoutWhatsapp },
        telegram: {
            start: startTelegram,
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
                void stopTelegram().then(() => startTelegram());
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
    doctor: () => runDoctor({ backendUrl: config.backendUrl, session, hub, deviceTokenPresent: Boolean(config.backendApiToken), secretPaths, listenHost: config.localBind, version }),
});
startProgressUpstream({ backendUrl: config.backendUrl, hub, getToken: () => config.backendApiToken || loadSession()?.accessToken });
startWhatsapp();
startTelegram();
startMachineAgent(config.backendUrl, config.backendApiToken);
// Já logado de antes (session.json)? Confere se o token da máquina é dessa conta e, se não for, provisiona e
// reinicia o agente — quem já estava logado nunca precisa relogar pra máquina aparecer (ver device-auth.ts).
const savedJwt = loadSession()?.accessToken;
if (savedJwt) void ensureDeviceToken(savedJwt);
startOutboundPoller();
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