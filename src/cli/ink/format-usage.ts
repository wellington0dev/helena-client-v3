import type { TurnUsage } from "../backend.ts";

function compactNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}

function formatDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Linha discreta de custo do turno (padrão Claude Code) — pedido do dono,
 * 2026-09-11: nada mostrava tokens/tempo gasto na hora, só no painel
 * admin depois. `↑`/`↓` seguem a mesma convenção de entrada/saída que o
 * painel de billing já usa.
 *
 * `cachedTokens` só aparece quando > 0 (cache hit de verdade) — o backend
 * já manda esse campo (ver captureUsageMiddleware), mas ficava sem uso
 * aqui: o dono via só "↑15.9k" sem jeito de saber quanto disso era cache
 * implícito do Gemini (barato/rápido) e quanto era processado de novo.
 * Omitido quando 0/ausente pra não sujar toda mensagem sem cache com um
 * "(0 cache)" inútil — a 1ª mensagem de cada sessão nunca tem cache
 * nenhum pra reaproveitar, isso é esperado, não um bug.
 */
export function formatUsageLine(usage: TurnUsage): string {
    const tokenParts: string[] = [];
    if (usage.inputTokens !== undefined) {
        const cacheNote = usage.cachedTokens ? ` (${compactNumber(usage.cachedTokens)} cache)` : "";
        tokenParts.push(`↑${compactNumber(usage.inputTokens)}${cacheNote}`);
    }
    if (usage.outputTokens !== undefined) {
        const thoughtsNote = usage.thoughtsTokens ? ` (+${compactNumber(usage.thoughtsTokens)} thinking)` : "";
        tokenParts.push(`↓${compactNumber(usage.outputTokens)}${thoughtsNote}`);
    }
    const tokensPrefix = tokenParts.length > 0 ? `${tokenParts.join(" ")} tokens · ` : "";
    return `${tokensPrefix}${formatDuration(usage.durationMs)}`;
}
