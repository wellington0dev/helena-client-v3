import { config } from "./config.ts";
import { startPanelServer } from "./panel/server.ts";
import { startWhatsapp } from "./channels/whatsapp.ts";
import { startTelegram } from "./channels/telegram.ts";
import { startOutboundPoller } from "./outbound-poller.ts";

/**
 * Entrypoint único do client/ — sobe o painel local SEMPRE (mesmo sem
 * nenhum canal configurado ainda, é dali que a configuração acontece — ver
 * docs/architecture-v2.md §4), tenta os canais, e inicia o poller de saída
 * (mensagens que o backend-v2 precisa entregar por iniciativa própria —
 * ver outbound-poller.ts). Substitui os scripts separados `helena
 * whatsapp`/`helena telegram` do cli/: aqui é um processo só, porque o
 * painel precisa ver o estado dos dois pra mostrar status ao vivo, e o
 * poller de saída depende dos dois já estarem conectados pra entregar.
 */
startPanelServer(config.panelPort, config.backendUrl);
startWhatsapp();
startTelegram();
startOutboundPoller();
