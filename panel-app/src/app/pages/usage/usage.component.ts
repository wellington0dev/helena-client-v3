import { Component, computed, inject, signal } from "@angular/core";
import type { UsageSummary } from "../../core/profile.service";
import { ProfileService } from "../../core/profile.service";

interface DayBar {
    label: string;
    calls: number;
    heightPct: number;
}
interface ChannelTile {
    label: string;
    value: number;
}

const CHANNEL_LABELS: Record<string, string> = { panel: "Chat", whatsapp: "WhatsApp", telegram: "Telegram", cli: "API" };
const CHANNEL_ORDER = ["panel", "whatsapp", "telegram", "cli"];
const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Página dedicada de consumo — antes era um card pequeno dentro do Perfil; separada pra dar o mesmo destaque que o design importado dá a "Uso" na navegação. Reusa a mesma UsageSummary do Perfil, só muda a apresentação (4 canais fixos + últimos 7 dias, em vez de 30 dias/canais dinâmicos). */
@Component({
    selector: "app-usage",
    templateUrl: "./usage.component.html",
    styleUrl: "./usage.component.css",
})
export class UsageComponent {
    private readonly profile = inject(ProfileService);

    protected readonly usage = signal<UsageSummary | null>(null);
    protected readonly loaded = signal(false);

    protected readonly channelTiles = computed<ChannelTile[]>(() => {
        const byChannel = this.usage()?.callsByChannel ?? {};
        return CHANNEL_ORDER.map((key) => ({ label: CHANNEL_LABELS[key], value: byChannel[key] ?? 0 }));
    });

    protected readonly weekBars = computed<DayBar[]>(() => {
        const usage = this.usage();
        const byDate = new Map((usage?.callsByDay ?? []).map((d) => [d.date.slice(0, 10), d.calls]));
        const today = new Date();
        const last7 = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(today.getTime() - (6 - i) * 86400000);
            return { label: WEEKDAY_LABELS[d.getDay()], calls: byDate.get(dayKey(d)) ?? 0 };
        });
        const max = Math.max(...last7.map((d) => d.calls), 1);
        return last7.map((d) => ({ ...d, heightPct: Math.max(3, Math.round((d.calls / max) * 100)) }));
    });

    constructor() {
        void this.profile.usage().then((usage) => {
            this.usage.set(usage);
            this.loaded.set(true);
        });
    }
}
