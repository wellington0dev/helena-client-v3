import React from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import { COMMANDS, type Command } from "./commands.ts";
import { looksLikeMouse, useMouse, type MouseEvent } from "./mouse.ts";
import { buildRows, descriptionLines, filterItems, hitTest, moveSelection, settingsLayout, windowRows, type SectionedItem } from "./settings-model.ts";
import { bg, theme } from "./theme.ts";

const h = React.createElement;

export interface PaletteItem extends SectionedItem {
    command: Command;
}

/**
 * Reagrupa `COMMANDS` por seção sem depender da ordem do array (essa ordem é a do "/" no composer e do /help,
 * fixada por `commands.test.ts` — não mexer nela só por causa daqui): junta cada seção num bloco contíguo, na
 * ordem em que aparece pela 1ª vez, preservando a ordem relativa dentro dela. Sem isso `buildRows` (que só abre um
 * cabeçalho novo quando a seção MUDA em relação ao item anterior) repetiria o cabeçalho de uma mesma seção toda
 * vez que ela reaparecesse intercalada com outra.
 */
export function buildPaletteItems(): PaletteItem[] {
    const buckets = new Map<string, Command[]>();
    for (const command of COMMANDS) {
        const bucket = buckets.get(command.section);
        if (bucket) bucket.push(command);
        else buckets.set(command.section, [command]);
    }
    return [...buckets.values()].flat().map((command) => ({ id: command.name, section: command.section, label: `/${command.name}`, description: command.description, command }));
}

export interface CommandPaletteModalProps {
    columns: number;
    usableRows: number;
    /** Comando escolhido (Enter ou clique) — quem monta decide o que roda e fecha a paleta. */
    onRun: (command: Command) => void;
    onClose: () => void;
}

/**
 * Paleta de comandos (Ctrl+P, ver app.ts): mesmo motor de modal do menu de configurações
 * (`settings-model.ts` — filtro, seções, janela de rolagem, hit-test do mouse), só que sem toggle: todo item aqui
 * é "rodar o comando e fechar". Teclado 100% funcional; mouse é adicional (ver mouse.ts).
 */
export function CommandPaletteModal(props: CommandPaletteModalProps): React.ReactElement {
    const { columns, usableRows, onRun, onClose } = props;
    const [query, setQuery] = React.useState("");
    const [selected, setSelected] = React.useState(0);

    const allItems = React.useMemo(() => buildPaletteItems(), []);
    const items = React.useMemo(() => filterItems(allItems, query), [allItems, query]);
    const rows = React.useMemo(() => buildRows(items), [items]);
    // altura do modal fixa pela lista COMPLETA — filtrar não faz o menu encolher e pular de lugar
    const layout = settingsLayout(columns, usableRows, buildRows(allItems).length);
    const current = items.length === 0 ? -1 : Math.min(selected, items.length - 1);
    const win = windowRows(rows, Math.max(0, current), layout.listRows);
    const currentItem = current >= 0 ? items[current] : undefined;

    function activate(item: PaletteItem | undefined): void {
        if (!item) return;
        onRun(item.command);
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
    const description = descriptionLines(currentItem ? currentItem.description : items.length === 0 ? "Nenhum comando encontrado." : "", layout.innerWidth);

    return h(
        Box,
        { position: "absolute", top: layout.top, left: layout.left, width: layout.width, height: layout.height, flexDirection: "column", backgroundColor: bg.modal, paddingX: 2, paddingY: 1 },
        h(
            Box,
            { justifyContent: "space-between", width: layout.innerWidth },
            h(Text, { bold: true, color: theme.primary }, "Comandos"),
            h(Text, { color: theme.textMuted, wrap: "truncate" }, "esc fecha"),
        ),
        h(
            Box,
            { width: layout.innerWidth, backgroundColor: bg.surface, paddingX: 1 },
            h(Text, { wrap: "truncate" }, query ? `⌕ ${query}${chalk.inverse(" ")}` : chalk.hex(theme.textMuted)("⌕ digite para filtrar")),
        ),
        h(Text, null, " "),
        ...visible.map((row, i) => {
            if (row.kind === "header") return h(Box, { key: `h-${row.section}-${i}`, width: layout.innerWidth, paddingX: 1 }, h(Text, { bold: true, color: theme.textMuted, wrap: "truncate" }, row.section.toUpperCase()));
            const active = row.itemIndex === current;
            return h(Box, { key: row.item.id, width: layout.innerWidth, paddingX: 1, ...(active ? { backgroundColor: bg.selected } : {}) }, h(Text, { bold: active, wrap: "truncate" }, row.item.label));
        }),
        ...Array.from({ length: blanks }, (_, i) => h(Text, { key: `b-${i}` }, " ")),
        h(Text, null, " "),
        ...description.map((line, i) => h(Text, { key: `d-${i}`, color: theme.textMuted, wrap: "truncate" }, line || " ")),
        h(Text, { color: theme.textMuted, wrap: "truncate" }, "↑↓ ou mouse · Enter/clique roda · roda rola · Esc fecha"),
    );
}
