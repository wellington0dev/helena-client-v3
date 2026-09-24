/**
 * Dinheiro na TUI (créditos em R$, 2026-09-24). Custo de UMA mensagem é pequeno (~R$ 0,06; no modelo leve,
 * ~R$ 0,002), então usa 4 casas — com 2, quase tudo viraria "R$ 0,00" ou "R$ 0,06" sem diferença visível entre
 * mensagens. Saldo e totais usam 2 casas, mas nunca mostram "R$ 0,00" pra um valor positivo.
 */
export function formatCost(brl: number | null | undefined): string {
    if (brl === null || brl === undefined) return "—";
    return `R$ ${brl.toFixed(4).replace(".", ",")}`;
}

export function formatMoney(brl: number | null | undefined): string {
    if (brl === null || brl === undefined) return "—";
    if (brl > 0 && brl < 0.01) return formatCost(brl);
    const sign = brl < 0 ? "-" : "";
    const [int, dec] = Math.abs(brl).toFixed(2).split(".");
    return `${sign}R$ ${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

/** 31234 → "31k", 1_250_000 → "1.2M" — cabe na sidebar de 30 colunas. */
export function compactTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return String(n);
}
