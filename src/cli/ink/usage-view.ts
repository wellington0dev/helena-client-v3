import type { UsageSummary } from "../api/usage.ts";

/** Mesma lógica de `panel-app/src/app/pages/usage/usage.component.ts` — ordem/rótulos fixos dos 4 canais, últimos 7 dias preenchidos com 0 (a API só devolve dias com atividade), altura normalizada com piso visual de 3% (senão a barra some quando calls=0). Função pura testável sem renderizar nada. */
const CHANNEL_ORDER = ["panel", "whatsapp", "telegram", "cli"] as const;
const CHANNEL_LABELS: Record<(typeof CHANNEL_ORDER)[number], string> = { panel: "Chat", whatsapp: "WhatsApp", telegram: "Telegram", cli: "API" };
const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export interface ChannelTile {
    key: string;
    label: string;
    value: number;
}

export interface WeekBar {
    date: string;
    label: string;
    calls: number;
    heightPct: number;
}

export interface UsageView {
    channelTiles: ChannelTile[];
    weekBars: WeekBar[];
}

function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** `today` é injetável só pra teste determinístico — em produção sempre `new Date()` (default). */
export function buildUsageView(usage: UsageSummary, today: Date = new Date()): UsageView {
    const channelTiles = CHANNEL_ORDER.map((key) => ({ key, label: CHANNEL_LABELS[key], value: usage.callsByChannel[key] ?? 0 }));

    const byDate = new Map(usage.callsByDay.map((d) => [d.date, d.calls]));
    const days: { date: string; calls: number }[] = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const iso = toIsoDate(d);
        days.push({ date: iso, calls: byDate.get(iso) ?? 0 });
    }

    const max = Math.max(...days.map((d) => d.calls), 1);
    const weekBars = days.map((d) => {
        // "T00:00:00" (sem "Z") faz o Date parsear em horário LOCAL — evita o dia da semana deslocar em fusos negativos.
        const weekday = new Date(`${d.date}T00:00:00`).getDay();
        const heightPct = Math.max(3, Math.round((d.calls / max) * 100));
        return { date: d.date, label: WEEKDAY_LABELS[weekday]!, calls: d.calls, heightPct };
    });

    return { channelTiles, weekBars };
}
