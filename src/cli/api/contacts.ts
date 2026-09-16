import { authed } from "./http.ts";

/**
 * Espelha `panel-app/src/app/core/contacts.service.ts` — mesmo protocolo
 * REST (`backend-v2/src/contacts/contacts.controller.ts`). Sem `create`
 * de propósito: contato nasce sozinho quando alguém manda mensagem pela
 * primeira vez (WhatsApp/Telegram), nunca é criado manualmente por aqui
 * nem pelo painel.
 */
export type GrantableTool = "notes" | "tasks" | "events";

export interface Contact {
    id: string;
    channel: "whatsapp" | "telegram";
    contactId: string;
    name?: string;
    relationship?: string;
    organization?: string;
    notes?: string;
    grantedTools?: GrantableTool[];
}

export interface ContactHistoryEntry {
    role: string;
    text: string;
    createdAt: string;
}

export interface ContactHistory {
    entries: ContactHistoryEntry[];
    total: number;
}

export function listContacts(baseUrl: string, token: string): Promise<Contact[]> {
    return authed(baseUrl, token, "GET", "/contacts");
}

export function getContact(baseUrl: string, token: string, id: string): Promise<Contact> {
    return authed(baseUrl, token, "GET", `/contacts/${id}`);
}

export function getContactHistory(baseUrl: string, token: string, id: string, limit?: number, offset?: number): Promise<ContactHistory> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set("limit", String(limit));
    if (offset !== undefined) params.set("offset", String(offset));
    const query = params.toString();
    return authed(baseUrl, token, "GET", `/contacts/${id}/history${query ? `?${query}` : ""}`);
}

export function updateContact(baseUrl: string, token: string, id: string, patch: Partial<Pick<Contact, "name" | "relationship" | "organization" | "notes" | "grantedTools">>): Promise<Contact> {
    return authed(baseUrl, token, "PATCH", `/contacts/${id}`, patch);
}

export function deleteContact(baseUrl: string, token: string, id: string): Promise<{ deleted: true }> {
    return authed(baseUrl, token, "DELETE", `/contacts/${id}`);
}
