/**
 * Formatação monetária na TUI. Custo de UMA mensagem é pequeno (~R$ 0,06; no modelo leve,
 * ~R$ 0,002), então usa 4 casas — com 2, quase tudo viraria "R$ 0,00" ou "R$ 0,06" sem diferença visível entre
 * mensagens. Valores monetários e créditos usam 2 casas nos totais.
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

/** Quantidade de créditos: mesma precisão do saldo, sem símbolo de moeda. */
export function formatCredits(credits: number | null | undefined): string {
    if (credits === null || credits === undefined) return "—";
    const sign = credits < 0 ? "-" : "";
    const absolute = Math.abs(credits);
    const decimals = absolute > 0 && absolute < 0.01 ? 4 : 2;
    const [int, dec] = absolute.toFixed(decimals).split(".");
    return `${sign}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

/** 31234 → "31k", 1_250_000 → "1.2M" — cabe na sidebar de 30 colunas. */
export function compactTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return String(n);
}

/**
 * Valor em R$ digitado num campo de formulário: "2", "2,50", "R$ 1.234,50" ou "2.5". Vazio → `null` (quem chama
 * decide o que vazio significa — ex: "usar o padrão"). Texto que não é número → `undefined` (inválido).
 */
export function parseBrlInput(raw: string | undefined): number | null | undefined {
    const text = (raw ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
    if (text === "") return null;
    // "1.234,50" (BR) → tira o ponto de milhar; "2.5" (sem vírgula) → ponto decimal mesmo.
    const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return undefined;
    return Number(normalized);
}
