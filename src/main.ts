import { config } from "./config.ts";
import { startPanelServer } from "./panel/server.ts";
import { startWhatsapp, stopWhatsapp } from "./channels/whatsapp.ts";
import { startTelegram } from "./channels/telegram.ts";
import { startMachineAgent } from "./machine-agent.ts";
import { startOutboundPoller } from "./outbound-poller.ts";

/**
 * Entrypoint único do client/ — sobe o painel local SEMPRE (mesmo sem
 * nenhum canal configurado ainda, é dali que a configuração acontece — ver
 * docs/architecture-v2.md §4), tenta os canais, registra esta máquina como
 * executora de comando (absorve o antigo `helena agent` do cli/ — ver
 * machine-agent.ts), e inicia o poller de saída (mensagens que o
 * backend-v2 precisa entregar por iniciativa própria — ver
 * outbound-poller.ts). Um processo só: o painel precisa ver o estado de
 * tudo isso pra mostrar status ao vivo, e o poller de saída depende dos
 * canais já estarem conectados pra entregar.
 */
startPanelServer(config.panelPort, config.backendUrl);
startWhatsapp();
startTelegram();
startMachineAgent(config.backendUrl, config.backendApiToken);
startOutboundPoller();

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
