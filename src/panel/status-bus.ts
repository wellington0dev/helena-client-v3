/**
 * Estado dos canais compartilhado entre as pontes (whatsapp.ts/telegram.ts)
 * e o servidor do painel (server.ts) — pub-sub em memória bem pequeno, sem
 * dependência nova. O painel assina mudanças e empurra pro navegador via
 * WebSocket; QR do WhatsApp em imagem (data URL) mora aqui pra o navegador
 * poder mostrar sem precisar de terminal (pedido explícito — ver
 * docs/architecture-v2.md §4, "Tem como exibirmos o qr... no navegador?").
 */

export type ChannelStatus = "disconnected" | "connecting" | "qr" | "connected" | "error";

export interface WhatsappState {
    status: ChannelStatus;
    qrDataUrl?: string;
    error?: string;
}

export interface TelegramState {
    status: ChannelStatus;
    error?: string;
}

export interface MachineAgentState {
    status: ChannelStatus;
    machineName?: string;
    error?: string;
}

export interface ClientState {
    whatsapp: WhatsappState;
    telegram: TelegramState;
    machineAgent: MachineAgentState;
}

const state: ClientState = {
    whatsapp: { status: "disconnected" },
    telegram: { status: "disconnected" },
    machineAgent: { status: "disconnected" },
};

type Listener = (state: ClientState) => void;
const listeners = new Set<Listener>();

function notify(): void {
    for (const listener of listeners) listener(state);
}

export function getState(): ClientState {
    return state;
}

export function updateWhatsapp(patch: Partial<WhatsappState>): void {
    Object.assign(state.whatsapp, patch);
    notify();
}

export function updateTelegram(patch: Partial<TelegramState>): void {
    Object.assign(state.telegram, patch);
    notify();
}

export function updateMachineAgent(patch: Partial<MachineAgentState>): void {
    Object.assign(state.machineAgent, patch);
    notify();
}

/** Retorna uma função pra cancelar a inscrição. */
export function onStateChange(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
