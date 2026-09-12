import type { TurnUsage } from "../backend.ts";

function compactNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function formatDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** Linha discreta de custo do turno (padrão Claude Code) — pedido do dono, 2026-09-11: nada mostrava tokens/tempo gasto na hora, só no painel admin depois. `↑`/`↓` seguem a mesma convenção de entrada/saída que o painel de billing já usa. */
export function formatUsageLine(usage: TurnUsage): string {
    const tokenParts: string[] = [];
    if (usage.inputTokens !== undefined) tokenParts.push(`↑${compactNumber(usage.inputTokens)}`);
    if (usage.outputTokens !== undefined) tokenParts.push(`↓${compactNumber(usage.outputTokens)}`);
    const tokensPrefix = tokenParts.length > 0 ? `${tokenParts.join(" ")} tokens · ` : "";
    return `${tokensPrefix}${formatDuration(usage.durationMs)}`;
}
