import { Injectable, signal } from "@angular/core";

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

export interface ClientState {
    whatsapp: WhatsappState;
    telegram: TelegramState;
}

/**
 * Ponte pro estado REAL de WhatsApp/Telegram desta máquina — o mesmo `/ws`
 * que `status-bus.ts` já expunha antes da migração (server.ts do client/,
 * não o backend-v2: por isso conecta no PRÓPRIO host do painel, sem passar
 * pelo `API_BASE_URL`/interceptor).
 */
@Injectable({ providedIn: "root" })
export class ChannelsService {
    readonly state = signal<ClientState>({ whatsapp: { status: "disconnected" }, telegram: { status: "disconnected" } });

    constructor() {
        if (typeof window === "undefined") return;
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${location.host}/ws`);
        ws.onmessage = (event) => this.state.set(JSON.parse(event.data));
    }
}
