import type { UsageMessage } from "../api/usage.ts";
import { compactTokens, formatCost, formatMoney } from "./format-money.ts";

export interface SpendingInfo {
    /** Créditos restantes em R$ — `undefined` enquanto carrega (ou se o backend não respondeu). */
    balanceBrl?: number;
    /** Custo da mensagem mais recente desta sessão (vem na própria resposta do chat, sem esperar o histórico). */
    lastCostBrl?: number | null;
    sessionCostBrl?: number | null;
    todayCostBrl?: number;
    /** Mais recente primeiro. */
    messages: UsageMessage[];
}

export interface SpendingLine {
    text: string;
    tone?: "title" | "muted" | "warning";
}

/** Linhas fixas do bloco antes do histórico: título + saldo + última + sessão + hoje + cabeçalho do histórico. */
export const SPENDING_FIXED_ROWS = 6;

function row(label: string, value: string, width: number): string {
    const gap = Math.max(1, width - label.length - value.length);
    return `${label}${" ".repeat(gap)}${value}`.slice(0, width);
}

function timeOf(iso: string): string {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * Bloco "Gastos" da sidebar (pedido do dono, 2026-09-24: custo por mensagem na sidebar em vez de embaixo do input,
 * com histórico). Devolve EXATAMENTE no máximo `maxRows` linhas, cada uma com no máximo `width` colunas — a sidebar
 * tem altura fixa e estourar empurraria o layout (mesma regra de medir antes de desenhar do viewport.ts).
 */
export function spendingLines(info: SpendingInfo, width: number, maxRows: number): SpendingLine[] {
    if (maxRows <= 0) return [];
    const lines: SpendingLine[] = [
        { text: "Gastos", tone: "title" },
        { text: row("Saldo", info.balanceBrl === undefined ? "…" : formatMoney(info.balanceBrl), width), tone: info.balanceBrl !== undefined && info.balanceBrl <= 0 ? "warning" : undefined },
        { text: row("Última msg", formatCost(info.lastCostBrl), width) },
        { text: row("Sessão", formatMoney(info.sessionCostBrl), width) },
        { text: row("Hoje", formatMoney(info.todayCostBrl), width) },
        { text: "── por mensagem ──".slice(0, width), tone: "muted" },
    ];
    const historyRows = Math.max(0, maxRows - lines.length);
    const history = info.messages.slice(0, historyRows).map((m): SpendingLine => {
        const tokens = compactTokens(m.inputTokens + m.outputTokens + m.thoughtsTokens);
        return { text: row(`${timeOf(m.at)} ${tokens}`, formatCost(m.costBrl), width), tone: "muted" };
    });
    if (info.messages.length === 0 && historyRows > 0) history.push({ text: "(nenhuma ainda)", tone: "muted" });
    return [...lines, ...history].slice(0, maxRows);
}
