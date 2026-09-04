/**
 * Cliente HTTP pro backend-v2 (Nest, multiusuário — ver
 * docs/architecture-v2.md) — chama `POST /channels/inbound`, autenticado
 * pelo token de longa duração emitido em `POST /auth/api-tokens` (nunca o
 * `PANEL_AUTH_TOKEN`/JWT de 24h do usuário logado no navegador, ver §3/§4
 * do doc). Deliberadamente simples (`fetch` cru, sem WS): o backend-v2
 * ainda não tem streaming pro chat de canal nesta fase — a resposta vem
 * inteira, de uma vez, na própria resposta HTTP.
 *
 * Função pura em vez de classe de propósito: uma classe com parâmetro de
 * construtor (`constructor(private x: T)`) não roda sob
 * `--experimental-strip-types` (o modo nativo de TS deste pacote, ver
 * package.json) — aquele açúcar sintático gera código de verdade (atribui
 * o campo), não é só apagar tipo, e o modo strip-only recusa com
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Mesmo padrão funcional já usado em
 * todo o resto do projeto (contact-store.ts, notes-store.ts etc no backend
 * single-owner nunca usam classe).
 */

export interface InboundImagePayload {
    mimeType: string;
    base64: string;
    caption?: string;
}

export interface InboundMessagePayload {
    channel: "whatsapp" | "telegram";
    contactId: string;
    senderName?: string;
    /** Ausente quando a mensagem é uma imagem sem legenda — ver `image`. */
    text?: string;
    image?: InboundImagePayload;
}

export interface InboundMessageResult {
    sessionId: string;
    text: string;
}

export async function sendInboundMessage(baseUrl: string, apiToken: string, payload: InboundMessagePayload): Promise<InboundMessageResult | { blocked: true }> {
    const response = await fetch(`${baseUrl}/channels/inbound`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`backend-v2 respondeu ${response.status}: ${body}`);
    }

    return response.json() as Promise<InboundMessageResult | { blocked: true }>;
}

export interface GroupInboundMessagePayload {
    channel: "whatsapp" | "telegram";
    groupId: string;
    groupName: string;
    senderName: string;
    text: string;
    mentioned: boolean;
}

/** `mentioned` já resolvido pelo chamador (client/) — ver channels/whatsapp.ts/telegram.ts, únicos lugares com acesso às estruturas específicas de canal pra detectar menção/reply. */
export async function sendGroupInboundMessage(baseUrl: string, apiToken: string, payload: GroupInboundMessagePayload): Promise<InboundMessageResult | { blocked: true } | { noReply: true }> {
    const response = await fetch(`${baseUrl}/channels/group-inbound`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`backend-v2 respondeu ${response.status}: ${body}`);
    }

    return response.json() as Promise<InboundMessageResult | { blocked: true } | { noReply: true }>;
}

export interface PendingOutboundMessage {
    id: string;
    channel: "whatsapp" | "telegram";
    contactId: string;
    text: string;
}

/** Consultado periodicamente pelo outbound-poller — ver outbound-poller.ts. */
export async function fetchPendingOutbound(baseUrl: string, apiToken: string): Promise<PendingOutboundMessage[]> {
    const response = await fetch(`${baseUrl}/channels/pending-outbound`, {
        headers: { Authorization: `Bearer ${apiToken}` },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`backend-v2 respondeu ${response.status}: ${body}`);
    }

    const { messages } = (await response.json()) as { messages: PendingOutboundMessage[] };
    return messages;
}
