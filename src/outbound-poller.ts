import { fetchPendingOutbound, type PendingOutboundMessage } from "./channels/backend-client.ts";
import { sendTelegramMessage } from "./channels/telegram.ts";
import { sendWhatsappMessage } from "./channels/whatsapp.ts";
import { config, hasBackendConfig } from "./config.ts";

/**
 * Consulta periodicamente `GET /channels/pending-outbound` — o backend-v2
 * enfileira ali quando precisa falar por iniciativa própria com um contato
 * (lembrete de calendário, aviso de pagamento confirmado — ver
 * backend-v2/src/calendar/). Sem WebSocket/push de verdade nesta leva:
 * polling simples, mesmo espírito do resto do projeto (AsaasPollerService).
 *
 * Se o canal alvo não estiver conectado no momento (ex: WhatsApp ainda
 * reconectando), a entrega falha e o LOG registra — a mensagem já foi
 * marcada como entregue no backend-v2 no momento da busca (trade-off
 * aceito, ver OutboundQueueService), então não há nova tentativa
 * automática por essa mensagem específica.
 */
const POLL_INTERVAL_MS = 15_000;

async function deliverOne(message: PendingOutboundMessage): Promise<void> {
    if (message.channel === "whatsapp") {
        await sendWhatsappMessage(`${message.contactId}@s.whatsapp.net`, message.text);
    } else if (message.channel === "telegram") {
        await sendTelegramMessage(message.contactId, message.text);
    } else {
        console.error(`[outbound-poller] canal desconhecido: ${message.channel}`);
    }
}

async function pollOnce(): Promise<void> {
    const messages = await fetchPendingOutbound(config.backendUrl, config.backendApiToken);
    for (const message of messages) {
        try {
            await deliverOne(message);
        } catch (error) {
            console.error(`[outbound-poller] falha ao entregar mensagem ${message.id} (${message.channel}):`, error);
        }
    }
}

export function startOutboundPoller(): void {
    if (!hasBackendConfig()) return; // sem backend configurado, nada a consultar — mesmo critério de startWhatsapp/startTelegram.

    setInterval(() => {
        pollOnce().catch((error) => console.error("[outbound-poller] loop:", error));
    }, POLL_INTERVAL_MS);
}
