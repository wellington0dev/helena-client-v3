import { parseBlocks, type Block, type FormItem } from "../../channels/markdown.ts";
import type { HistoryItem } from "./history-item.ts";
import { countWrappedLines } from "./viewport.ts";

/**
 * "Modo resposta" da TUI (docs/formato-interativo-chat.md) — só a ÚLTIMA mensagem da Helena pode virar
 * interativa, e só quando o widget que a TUI já tem (SelectMenu/Form, ambos de escolha ÚNICA — ver
 * select-menu.ts/form.ts) dá conta do bloco: `<select multiple="true">` (precisaria de multi-seleção,
 * inexistente hoje) e `<form>` com `<select>` aninhado ou mais de um `<button>` (Form só tem UM submit) caem
 * fora da v1 e ficam só na renderização estática (render-markdown.ts) — o dono continua podendo responder
 * digitando livremente, igual sempre.
 */
export type AnswerableBlock = { kind: "select"; block: Extract<Block, { kind: "select" }> } | { kind: "form"; block: Extract<Block, { kind: "form" }> } | { kind: "button"; block: Extract<Block, { kind: "button" }> };

/** `null` quando a última mensagem não é da Helena, ou é da Helena mas não tem bloco interativo respondível nesta versão. */
export function findLatestAnswerable(history: HistoryItem[]): AnswerableBlock | null {
    const last = history[history.length - 1];
    if (!last || last.role !== "assistant") return null;

    for (const block of parseBlocks(last.text)) {
        if (block.kind === "select" && !block.multiple) return { kind: "select", block };
        if (block.kind === "button") return { kind: "button", block };
        if (block.kind === "form") {
            const buttons = block.items.filter((item): item is Extract<FormItem, { kind: "button" }> => item.kind === "button");
            const hasNestedSelect = block.items.some((item) => item.kind === "select");
            if (buttons.length === 1 && !hasNestedSelect) return { kind: "form", block };
        }
    }
    return null;
}

/** `<select>` avulso — "Pergunta: opção escolhida" (docs/formato-interativo-chat.md §2). */
export function composeSelectAnswer(label: string, optionText: string): string {
    return `${label}: ${optionText}`;
}

/** `<form>` — uma linha "Label: valor" por input, na ordem em que aparecem (§2). Só inputs: forms com select aninhado nunca chegam aqui, ver findLatestAnswerable. */
export function composeFormAnswer(items: FormItem[], values: Record<string, string>): string {
    return items
        .filter((item): item is Extract<FormItem, { kind: "input" }> => item.kind === "input")
        .map((item) => `${item.label}: ${values[item.name] ?? ""}`)
        .join("\n");
}

/**
 * Altura em linhas do `SelectMenu` montado pra um `<select>` respondível — mesmo estilo de
 * `permission-dialog.ts#measurePermissionDialog`, usado pro orçamento de altura do live region (ver
 * `liveRegionRows` em app.ts). SelectMenu não tem borda/padding, só 1 linha por opção (mais margem de
 * quebra se o texto da opção for comprido — "❯ N) " ocupa uns 5 caracteres de prefixo).
 */
export function measureSelectAnswer(block: Extract<Block, { kind: "select" }>, columns: number): number {
    const inner = Math.max(1, columns - 5);
    return block.options.reduce((sum, opt) => sum + countWrappedLines(opt.text, inner), 0);
}

/**
 * Altura em linhas do `Form` montado pra um `<form>` respondível. `panel("border")` (ver theme.ts) contribui
 * 2 linhas de padding (topo/base, mesma geometria de uma borda 1+1 — ver comentário em theme.ts#panel); título
 * (quando existe) soma 2 (a linha do título + o espaçador logo abaixo, ver form.ts); cada campo é 1 linha
 * (rótulo + TextInput lado a lado); e sempre tem o espaçador antes da dica + a linha de dica no fim.
 */
export function measureFormAnswer(block: Extract<Block, { kind: "form" }>, columns: number): number {
    const inner = Math.max(1, columns - 4);
    const fieldRows = block.items.filter((item): item is Extract<FormItem, { kind: "input" }> => item.kind === "input").reduce((sum, item) => sum + countWrappedLines(item.label, inner), 0);
    const titleRows = block.label ? 2 : 0;
    const padding = 2;
    const spacerAndHint = 2;
    return padding + titleRows + fieldRows + spacerAndHint;
}
