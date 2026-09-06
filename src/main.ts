import { config } from "./config.ts";
import { startPanelServer } from "./panel/server.ts";
import { startWhatsapp } from "./channels/whatsapp.ts";
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
