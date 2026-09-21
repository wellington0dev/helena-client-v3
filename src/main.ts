import { config } from "./config.ts";
import fs from "node:fs";
import { ensureDeviceToken } from "./device-auth.ts";
import { createEventHub } from "./local-api/event-hub.ts";
import { loadOrCreateLocalToken } from "./local-api/local-token.ts";
import { startProgressUpstream } from "./local-api/progress-upstream.ts";
import { startLocalApi } from "./local-api/server.ts";
import { createSessionManager } from "./local-api/session-manager.ts";
import { clearSession, loadSession, saveSession } from "./cli/session-store.ts";
import { getState, onStateChange } from "./panel/status-bus.ts";
import { startWhatsapp, stopWhatsapp } from "./channels/whatsapp.ts";
import { startTelegram } from "./channels/telegram.ts";
import { startMachineAgent } from "./machine-agent.ts";
import { startOutboundPoller } from "./outbound-poller.ts";
import { reportError } from "./telemetry.ts";

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
});
startLocalApi({
    port: config.panelPort,
    host: config.localBind,
    version: (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version,
    localToken: loadOrCreateLocalToken(),
    session,
    hub,
});
startProgressUpstream({ backendUrl: config.backendUrl, hub, getToken: () => config.backendApiToken || loadSession()?.accessToken });
startWhatsapp();
startTelegram();
startMachineAgent(config.backendUrl, config.backendApiToken);
startOutboundPoller();

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
    await Promise.race([stopWhatsapp().catch((error) => console.error("[main] falha ao encerrar WhatsApp:", error)), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS))]);
    process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
