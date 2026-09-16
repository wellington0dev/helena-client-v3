import chalk from "chalk";

/**
 * Cores centralizadas da CLI — antes espalhadas como `chalk.cyan`/`color:
 * "cyan"` cru em `app.ts`/`config-screen.ts`/`select-menu.ts`. Tokens
 * derivados do uso REAL de hoje (nada especulativo): `accent` é um
 * segundo destaque deliberadamente distinto de `primary` (hoje "Helena"
 * é magenta, tudo o resto — bordas, títulos, cursor, spinner — é cyan) —
 * não fundir os dois na migração.
 *
 * Duas formas exportadas da MESMA fonte porque o código usa cor de dois
 * jeitos irreconciliáveis sob uma única forma: prop do Ink (`<Text
 * color="cyan">`) e `chalk` cru compondo uma string (`chalk.cyan.bold(x)`).
 */
export const theme = {
    primary: "cyan",
    accent: "magenta",
    success: "green",
    warning: "yellow",
    danger: "red",
    textMuted: "gray",
    /** Hoje sempre igual a `primary` em toda borda observada — token
     * separado só pra permitir divergir no futuro sem caçar cada uso. */
    border: "cyan",
} as const;

export const c = {
    primary: chalk.cyan,
    accent: chalk.magenta,
    success: chalk.green,
    warning: chalk.yellow,
    danger: chalk.red,
    /** Equivalente a `dimColor` do Ink, pra uso em string composta com `chalk`. */
    muted: chalk.dim,
} as const;
