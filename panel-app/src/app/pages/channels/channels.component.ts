import { NgClass } from "@angular/common";
import { Component, computed, inject } from "@angular/core";
import type { ChannelStatus } from "../../core/channels.service";
import { ChannelsService } from "../../core/channels.service";
import { IconComponent } from "../../shared/icon.component";

interface ChannelCard {
    key: "whatsapp" | "telegram";
    name: string;
    icon: string;
    statusLabel: string;
    statusClass: string;
    badgeLabel: string;
    showQr: boolean;
    qrDataUrl?: string;
    qrPending: boolean;
    showConnecting: boolean;
    showConnected: boolean;
    showError: boolean;
    errorMessage: string;
    showDisconnectedHint: boolean;
    disconnectedHint: string;
}

const STATUS_META: Record<ChannelStatus, { label: string; cls: string; badge: string }> = {
    disconnected: { label: "Desconectado", cls: "status-faint", badge: "Desconectado" },
    connecting: { label: "Conectando…", cls: "status-warn", badge: "Conectando" },
    qr: { label: "Aguardando leitura do QR", cls: "status-warn", badge: "Pareando" },
    connected: { label: "Conectado", cls: "status-success", badge: "Conectado" },
    error: { label: "Erro", cls: "status-danger", badge: "Erro" },
};

/** Cards WhatsApp/Telegram — status real via ChannelsService (WebSocket /ws do próprio client/, ver status-bus.ts). */
@Component({
    selector: "app-channels",
    imports: [NgClass, IconComponent],
    templateUrl: "./channels.component.html",
    styleUrl: "./channels.component.css",
})
export class ChannelsComponent {
    private readonly channels = inject(ChannelsService);

    protected readonly cards = computed<ChannelCard[]>(() => {
        const state = this.channels.state();
        return [
            this.buildCard("whatsapp", "WhatsApp", state.whatsapp, "Aguardando o processo do client/ iniciar a sessão do WhatsApp."),
            this.buildCard("telegram", "Telegram", state.telegram, "Configure TELEGRAM_BOT_TOKEN no .env do client/ e reinicie o processo pra conectar."),
        ];
    });

    private buildCard(key: "whatsapp" | "telegram", name: string, val: { status: ChannelStatus; qrDataUrl?: string; error?: string }, disconnectedHint: string): ChannelCard {
        const meta = STATUS_META[val.status];
        return {
            key,
            name,
            icon: key,
            statusLabel: val.error || meta.label,
            statusClass: meta.cls,
            badgeLabel: meta.badge,
            showQr: val.status === "qr",
            qrDataUrl: val.qrDataUrl,
            qrPending: val.status === "qr" && !val.qrDataUrl,
            showConnecting: val.status === "connecting",
            showConnected: val.status === "connected",
            showError: val.status === "error",
            errorMessage: val.error || "Erro no canal.",
            showDisconnectedHint: val.status === "disconnected",
            disconnectedHint,
        };
    }
}
