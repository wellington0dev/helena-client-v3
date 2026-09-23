import React from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import { looksLikeMouse, useMouse, type MouseEvent } from "./mouse.ts";
import { buildRows, descriptionLines, filterItems, hitTest, moveSelection, settingsLayout, windowRows, type SectionedItem } from "./settings-model.ts";
import { bg, SPACE, theme } from "./theme.ts";

const h = React.createElement;

/**
 * Modal genérico de lista agrupada por seção — chrome que `settings-modal.ts` (`/config`) e `command-palette.ts`
 * (Ctrl+P) tinham COPIADO quase idêntico até 2026-09-23 (título, campo de busca, lista rolável, rodapé de dica,
 * caixa centralizada). A matemática (filtro/janela/hit-test) já vivia em `settings-model.ts`, genérica; isto aqui
 * é o pedaço que faltava generalizar: o DESENHO + a interação de teclado/mouse por cima dela.
 *
 * O que fica de fora de propósito — cada tela cuida do próprio: buscar dados (`SettingsModal#me`), o que "ativar"
 * significa por item (toggle vs link vs rodar comando), e o texto do cabeçalho à direita (email da conta vs "esc
 * fecha"). Isso é só apresentação + navegação.
 */
export interface ListModalProps<T extends SectionedItem> {
    title: string;
    /** Canto superior direito do título — email da conta, "esc fecha", etc. */
    headerRight?: string;
    columns: number;
    usableRows: number;
    /** TODOS os itens, já na ordem/agrupamento final — filtro por texto roda por cima disto. */
    items: T[];
    onActivate: (item: T) => void;
    onClose: () => void;
    /** Conteúdo à direita da linha do item (pill de toggle, hint de link) — default: nada. */
    renderRight?: (item: T, active: boolean) => React.ReactElement | null;
    /** Mensagem quando o filtro não casa com nada. */
    emptyMessage?: string;
    footerHint?: string;
    /** Substitui o rodapé por uma mensagem (ex: erro ao salvar um toggle) — some sozinho quando a tela some `undefined`. */
    footerOverride?: { text: string; tone?: "danger" };
}

/** Ativa com a barra de espaço só quando a busca está vazia — digitar um espaço DEPOIS de já ter filtrado é texto de busca de verdade, não atalho (mesma regra desde a versão original em settings-modal.ts). */
export function ListModal<T extends SectionedItem>(props: ListModalProps<T>): React.ReactElement {
    const { title, headerRight, columns, usableRows, items: allItems, onActivate, onClose, renderRight, emptyMessage = "Nada encontrado.", footerHint = "↑↓ ou mouse · Enter/clique ativa · roda rola · Esc fecha", footerOverride } = props;
    const [query, setQuery] = React.useState("");
    const [selected, setSelected] = React.useState(0);

    const items = React.useMemo(() => filterItems(allItems, query), [allItems, query]);
    const rows = React.useMemo(() => buildRows(items), [items]);
    // altura do modal fixa pela lista COMPLETA — filtrar não faz o menu encolher e pular de lugar
    const layout = settingsLayout(columns, usableRows, buildRows(allItems).length);
    const current = items.length === 0 ? -1 : Math.min(selected, items.length - 1);
    const win = windowRows(rows, Math.max(0, current), layout.listRows);
    const currentItem = current >= 0 ? items[current] : undefined;

    function activate(item: T | undefined): void {
        if (item) onActivate(item);
    }

    function select(delta: number): void {
        setSelected(moveSelection(items.length, Math.max(0, current), delta));
    }

    useInput((input, key) => {
        if (looksLikeMouse(input)) return; // tratado por useMouse
        if (key.escape) {
            if (query) setQuery("");
            else onClose();
        } else if (key.upArrow) select(-1);
        else if (key.downArrow || key.tab) select(1);
        else if (key.pageUp) select(-layout.listRows);
        else if (key.pageDown) select(layout.listRows);
        else if (key.return) activate(currentItem);
        else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
        else if (input === " " && query === "") activate(currentItem);
        else if (input && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(input)) {
            setQuery((q) => q + input);
            setSelected(0);
        }
    });

    useMouse((event: MouseEvent) => {
        if (event.type === "wheelUp") return select(-1);
        if (event.type === "wheelDown") return select(1);
        const hit = hitTest(layout, event.x, event.y);
        if (event.type === "move") {
            const row = hit.area === "list" ? rows[win.start + hit.row] : undefined;
            if (row?.kind === "item" && row.itemIndex !== current) setSelected(row.itemIndex);
        } else if (event.type === "press" && event.button === "left") {
            if (hit.area === "outside") return onClose();
            const row = hit.area === "list" ? rows[win.start + hit.row] : undefined;
            if (row?.kind === "item") {
                setSelected(row.itemIndex);
                activate(row.item);
            }
        }
    }, true);

    const visible = rows.slice(win.start, win.end);
    const blanks = Math.max(0, layout.listRows - visible.length);
    const description = descriptionLines(currentItem ? currentItem.description : items.length === 0 ? emptyMessage : "", layout.innerWidth);

    return h(
        Box,
        { position: "absolute", top: layout.top, left: layout.left, width: layout.width, height: layout.height, flexDirection: "column", backgroundColor: bg.modal, paddingX: SPACE.loose, paddingY: SPACE.tight },
        h(
            Box,
            { justifyContent: "space-between", width: layout.innerWidth },
            h(Text, { bold: true, color: theme.primary }, title),
            h(Text, { color: theme.textMuted, wrap: "truncate" }, headerRight ?? "esc fecha"),
        ),
        h(
            Box,
            { width: layout.innerWidth, backgroundColor: bg.surface, paddingX: SPACE.tight },
            h(Text, { wrap: "truncate" }, query ? `⌕ ${query}${chalk.inverse(" ")}` : chalk.hex(theme.textMuted)("⌕ digite para filtrar")),
        ),
        h(Text, null, " "),
        ...visible.map((row, i) => {
            if (row.kind === "header") return h(Box, { key: `h-${row.section}-${i}`, width: layout.innerWidth, paddingX: SPACE.tight }, h(Text, { bold: true, color: theme.textMuted, wrap: "truncate" }, row.section.toUpperCase()));
            const active = row.itemIndex === current;
            const right = renderRight?.(row.item, active);
            return h(
                Box,
                { key: row.item.id, width: layout.innerWidth, justifyContent: right ? "space-between" : "flex-start", paddingX: SPACE.tight, ...(active ? { backgroundColor: bg.selected } : {}) },
                h(Text, { bold: active, wrap: "truncate" }, row.item.label),
                right ? h(Box, { flexShrink: 0, marginLeft: SPACE.tight }, right) : null,
            );
        }),
        ...Array.from({ length: blanks }, (_, i) => h(Text, { key: `b-${i}` }, " ")),
        h(Text, null, " "),
        ...description.map((line, i) => h(Text, { key: `d-${i}`, color: theme.textMuted, wrap: "truncate" }, line || " ")),
        h(Text, { color: footerOverride?.tone === "danger" ? theme.danger : theme.textMuted, wrap: "truncate" }, footerOverride?.text ?? footerHint),
    );
}
