import wrapAnsi from "wrap-ansi";
import { visibleWindow } from "./crud-screen.ts";

/**
 * Modelo PURO de modal em lista agrupada por seção (`settings-modal.ts` e `command-palette.ts` só desenham): filtro
 * por texto, janela de rolagem, geometria do modal e hit-test do mouse — genérico sobre QUALQUER item com
 * `id`/`section`/`label`/`description` (`SettingItem`, mais embaixo, é só a variante do menu de configurações, com
 * os campos extras de toggle/link). Tudo aqui é aritmética sobre a MESMA lista que a tela desenha — é assim que o
 * clique acerta a linha que se vê (o Ink não expõe coordenadas de tela, ver mouse.ts).
 */

export interface SectionedItem {
    id: string;
    section: string;
    label: string;
    description: string;
}

export interface SettingItem extends SectionedItem {
    kind: "toggle" | "link";
    /** Só toggle: `undefined` = ainda carregando/indisponível (não ativável). */
    value?: boolean;
    /** Só link: texto à direita (default "→"). */
    hint?: string;
}

export type DisplayRow<T extends SectionedItem = SettingItem> = { kind: "header"; section: string } | { kind: "item"; item: T; itemIndex: number };

/** minúsculas e sem acento — "configurações" casa com "config". */
export function normalize(text: string): string {
    return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Todas as palavras da busca precisam aparecer em rótulo, descrição ou seção. Busca vazia = tudo. */
export function filterItems<T extends SectionedItem>(items: T[], query: string): T[] {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return items;
    return items.filter((item) => {
        const haystack = normalize(`${item.label} ${item.description} ${item.section}`);
        return words.every((word) => haystack.includes(word));
    });
}

/** Agrupa por seção (na ordem em que aparecem), inserindo o cabeçalho antes do 1º item de cada uma. */
export function buildRows<T extends SectionedItem>(items: T[]): DisplayRow<T>[] {
    const rows: DisplayRow<T>[] = [];
    let current: string | undefined;
    items.forEach((item, itemIndex) => {
        if (item.section !== current) {
            current = item.section;
            rows.push({ kind: "header", section: item.section });
        }
        rows.push({ kind: "item", item, itemIndex });
    });
    return rows;
}

/** Janela [start,end) de `listRows` linhas que mantém o item selecionado visível; se ela começa logo abaixo de um cabeçalho, inclui o cabeçalho. */
export function windowRows<T extends SectionedItem>(rows: DisplayRow<T>[], selectedItemIndex: number, listRows: number): { start: number; end: number } {
    if (rows.length <= listRows) return { start: 0, end: rows.length };
    const cursor = Math.max(0, rows.findIndex((row) => row.kind === "item" && row.itemIndex === selectedItemIndex));
    let { start, end } = visibleWindow(rows.length, cursor, listRows);
    // só puxa o cabeçalho se o selecionado continua na janela depois do deslocamento (senão ele sairia pela ponta de baixo)
    if (start > 0 && rows[start - 1]?.kind === "header" && cursor < end - 1) {
        start -= 1;
        end -= 1;
    }
    return { start, end };
}

/** Move a seleção com volta nas pontas. `count` 0 → -1 (nada selecionável). */
export function moveSelection(count: number, index: number, delta: number): number {
    if (count <= 0) return -1;
    return (((index + delta) % count) + count) % count;
}

export const MODAL_CHROME_ROWS = 9; // padding 1 + título + busca + branco + [lista] + branco + descrição 2 + dica + padding 1
export const LIST_OFFSET = 4; // linhas do topo do modal até a 1ª linha da lista (padding, título, busca, branco)
export const MAX_LIST_ROWS = 16;
export const MIN_LIST_ROWS = 3;
export const DESCRIPTION_ROWS = 2;

export interface SettingsLayout {
    left: number;
    top: number;
    width: number;
    height: number;
    /** Linha absoluta (0-based) da 1ª linha da lista. */
    listTop: number;
    listRows: number;
    /** Colunas úteis dentro do modal (largura - padding lateral). */
    innerWidth: number;
}

export function settingsLayout(columns: number, usableRows: number, rowCount: number): SettingsLayout {
    const width = columns < 44 ? columns : Math.min(74, Math.max(40, columns - 4));
    const room = Math.max(MIN_LIST_ROWS, usableRows - MODAL_CHROME_ROWS - 2);
    const listRows = Math.min(MAX_LIST_ROWS, Math.max(MIN_LIST_ROWS, Math.min(rowCount, room)));
    const height = listRows + MODAL_CHROME_ROWS;
    const top = Math.max(0, Math.floor((usableRows - height) / 2));
    const left = Math.max(0, Math.floor((columns - width) / 2));
    return { left, top, width, height, listTop: top + LIST_OFFSET, listRows, innerWidth: Math.max(1, width - 4) };
}

export type HitResult = { area: "outside" } | { area: "modal" } | { area: "list"; row: number };

/** `x`/`y` 0-based (já convertidos por parseMouse). `row` é a posição DENTRO da janela visível (0..listRows-1). */
export function hitTest(layout: SettingsLayout, x: number, y: number): HitResult {
    const inside = x >= layout.left && x < layout.left + layout.width && y >= layout.top && y < layout.top + layout.height;
    if (!inside) return { area: "outside" };
    // padding lateral do modal (2 colunas) não é clicável como linha
    const inRow = y >= layout.listTop && y < layout.listTop + layout.listRows && x >= layout.left + 2 && x < layout.left + layout.width - 2;
    return inRow ? { area: "list", row: y - layout.listTop } : { area: "modal" };
}

/** Descrição do item em exatamente `DESCRIPTION_ROWS` linhas (a última com … se cortou), pra a altura do modal nunca variar. */
export function descriptionLines(text: string, width: number): string[] {
    const lines = wrapAnsi(text, Math.max(1, width), { hard: true, trim: true }).split("\n").filter((line) => line !== "");
    const shown = lines.slice(0, DESCRIPTION_ROWS);
    if (lines.length > DESCRIPTION_ROWS) {
        const last = shown[DESCRIPTION_ROWS - 1]!;
        shown[DESCRIPTION_ROWS - 1] = `${last.slice(0, Math.max(0, width - 1))}…`;
    }
    while (shown.length < DESCRIPTION_ROWS) shown.push("");
    return shown;
}
