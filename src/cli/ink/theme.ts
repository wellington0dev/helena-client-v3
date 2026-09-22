import chalk from "chalk";

/**
 * Tema escuro e suave da CLI (paleta na família Tokyo Night). Em vez de linhas/bordas, a hierarquia visual vem de
 * DIFERENÇA DE FUNDO: cada região (sidebar, mensagem do usuário, mensagem da Helena, campo de digitar, diálogos)
 * tem um tom próprio de fundo. Hex é convertido pelo chalk/Ink pro melhor que o terminal suportar (truecolor → 256).
 *
 * Tokens de TEXTO (`theme`, `c`) — cor de letra; tokens de FUNDO (`bg`) — cor de bloco. Mudar a paleta é só aqui:
 * nenhuma tela usa cor crua (ver theme.test.ts, que barra "cyan"/"red"/... espalhados de novo).
 */
export const bg = {
    /** Fundo geral do app (o mais "profundo" entre as áreas de leitura). */
    base: "#1a1b26",
    /** Sidebar e barra de status: um degrau mais escuro que a base, ficam "por fora" do conteúdo. */
    panel: "#16161e",
    /** Janelas sobrepostas (menu de configurações): mais escuras que QUALQUER área do chat, pra se destacarem do fundo. */
    modal: "#0d0e14",
    /** Campo de digitar, menus e telas de lista/formulário. */
    surface: "#24283b",
    /** Menus/sugestões que abrem em cima de uma área "surface" (autocomplete de / e @) — um degrau acima pra não se fundir com o campo de digitar. */
    raised: "#2f3550",
    /** Linha selecionada/sob o mouse em listas e menus. */
    selected: "#343b5e",
    /** Mensagem do usuário — azul acinzentado. */
    user: "#2b3556",
    /** Mensagem da Helena — violeta bem discreto. */
    helena: "#272536",
    /** Diálogo de permissão / confirmações — âmbar escurecido. */
    warning: "#3a3125",
    /** Erros. */
    danger: "#3b2530",
    /** Sucesso / confirmação. */
    success: "#233329",
} as const;

export const theme = {
    primary: "#7aa2f7",
    accent: "#bb9af7",
    success: "#9ece6a",
    warning: "#e0af68",
    danger: "#f7768e",
    /** Texto secundário legível sobre os fundos acima (não use `dimColor` junto — apaga duas vezes). */
    textMuted: "#7982a9",
    /** Texto principal. */
    text: "#c0caf5",
    /** Trechos de código inline. */
    code: "#7dcfff",
    /** Legado: bordas não existem mais, mas telas ainda passam `theme.border` em alguns lugares. */
    border: "#7aa2f7",
} as const;

export const c = {
    primary: chalk.hex(theme.primary),
    accent: chalk.hex(theme.accent),
    success: chalk.hex(theme.success),
    warning: chalk.hex(theme.warning),
    danger: chalk.hex(theme.danger),
    code: chalk.hex(theme.code),
    /** Texto secundário em string composta com `chalk`. */
    muted: chalk.hex(theme.textMuted),
} as const;

export type PanelKind = "border" | "surface" | "raised" | "warning" | "danger" | "success";

const PANEL_BG: Record<PanelKind, string> = {
    border: bg.surface,
    surface: bg.surface,
    raised: bg.raised,
    warning: bg.warning,
    danger: bg.danger,
    success: bg.success,
};

export const PANEL_PADDING_X = 2;
export const PANEL_PADDING_Y = 1;

/**
 * Props de `<Box>` de um bloco em destaque — SUBSTITUI o antigo `borderStyle:"round" + paddingX:1`.
 * A geometria é idêntica de propósito (borda 1 + padding 1 = padding 2 nas laterais; borda 1 = padding 1 em cima/embaixo),
 * então trocar borda por bloco colorido não mexe em nenhuma medição de altura/largura (ver viewport.ts).
 */
export function panel(kind: PanelKind = "surface"): { backgroundColor: string; paddingX: number; paddingY: number } {
    return { backgroundColor: PANEL_BG[kind], paddingX: PANEL_PADDING_X, paddingY: PANEL_PADDING_Y };
}

/**
 * Padding das caixas de MENSAGEM/AVISO no histórico. Única fonte: HistoryLine (app.ts) desenha com estes valores e
 * measureHistoryItem (viewport.ts) mede com os mesmos — mudar aqui muda os dois juntos.
 */
export const MESSAGE_PADDING_X = 2;
export const MESSAGE_PADDING_Y = 1;
/** Avisos de uma linha ("Conversa retomada.") ficam como faixa, sem respiro vertical. */
export const NOTICE_PADDING_Y = 0;
