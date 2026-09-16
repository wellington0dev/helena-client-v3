import React from "react";
import { Box, Text, useInput } from "ink";
import { c, theme } from "./theme.ts";

const h = React.createElement;

/**
 * Tela de lista genérica (Contatos/MCP/Tokens de API seguem essa MESMA
 * forma: lista + opcionalmente criar + opcionalmente apagar). Implementa
 * a própria navegação (não delega pro `SelectMenu`) porque precisa saber
 * qual item está sob o cursor pra oferecer a ação secundária de apagar
 * (`x`) — o `SelectMenu` esconde o cursor internamente.
 *
 * `onSelect` é a ação PRIMÁRIA do Enter (normalmente "editar"). Quando
 * `onSelect` não é passado mas `onDelete` é (caso de Tokens de API, que
 * não tem edição — só existe/revoga), o Enter cai direto no fluxo de
 * apagar. Isso preserva a forma mais simples (tokens) sem forçar toda
 * tela a ter uma ação de edição.
 *
 * Apagar SEMPRE passa por uma confirmação textual (s/n) antes de chamar
 * `onDelete` — mudança deliberada em relação ao comportamento antigo de
 * tokens (Enter revogava direto, sem confirmar).
 */
export interface CrudScreenProps<Item extends { id: string }> {
    title: string;
    /** `undefined` = carregando. */
    items: Item[] | undefined;
    itemLabel: (item: Item) => { label: string; hint?: string };
    /** Ação primária do Enter num item — ausente = Enter tenta apagar direto (ver onDelete). */
    onSelect?: (item: Item) => void;
    /** Ausente = sem "+ Criar novo" no menu. */
    onCreate?: () => void;
    createLabel?: string;
    /** Ausente = sem ação de apagar nenhuma (nem tecla `x`, nem fallback do Enter). */
    onDelete?: (item: Item) => Promise<void>;
    busy: boolean;
    error?: string;
    onExit: () => void;
}

type Row<Item> = { kind: "create" } | { kind: "item"; item: Item };

export function CrudScreen<Item extends { id: string }>(props: CrudScreenProps<Item>): React.ReactElement {
    const { title, items, itemLabel, onSelect, onCreate, createLabel = "+ Criar novo", onDelete, busy, error, onExit } = props;
    const [cursor, setCursor] = React.useState(0);
    const [confirming, setConfirming] = React.useState<Item | undefined>(undefined);

    const rows: Row<Item>[] = React.useMemo(() => {
        const itemRows: Row<Item>[] = (items ?? []).map((item) => ({ kind: "item", item }));
        return onCreate ? [{ kind: "create" }, ...itemRows] : itemRows;
    }, [items, onCreate]);

    useInput((input, key) => {
        if (busy || !items) return;

        if (confirming) {
            const normalized = input.trim().toLowerCase();
            if (normalized === "s") {
                const item = confirming;
                setConfirming(undefined);
                void onDelete?.(item);
            } else if (normalized === "n" || key.escape) {
                setConfirming(undefined);
            }
            return;
        }

        if (key.escape) {
            onExit();
            return;
        }
        if (key.upArrow) {
            setCursor((i) => (i - 1 + rows.length) % rows.length);
            return;
        }
        if (key.downArrow) {
            setCursor((i) => (i + 1) % rows.length);
            return;
        }
        if (key.return) {
            activateRow(rows[cursor]);
            return;
        }
        if (input === "x" && onDelete) {
            const row = rows[cursor];
            if (row?.kind === "item") setConfirming(row.item);
            return;
        }
        const digitIndex = "123456789".indexOf(input);
        if (digitIndex !== -1 && digitIndex < rows.length) {
            activateRow(rows[digitIndex]);
        }
    });

    function activateRow(row: Row<Item> | undefined): void {
        if (!row) return;
        if (row.kind === "create") {
            onCreate?.();
            return;
        }
        if (onSelect) {
            onSelect(row.item);
        } else if (onDelete) {
            setConfirming(row.item);
        }
    }

    if (confirming) {
        return h(
            Box,
            { flexDirection: "column", borderStyle: "round", borderColor: theme.warning, paddingX: 1 },
            h(Text, { bold: true, color: theme.warning }, `Apagar "${itemLabel(confirming).label}"?`),
            h(Text, { dimColor: true }, "Essa ação não pode ser desfeita."),
            h(Box, { marginTop: 1 }),
            h(Text, null, "Confirmar? (s/n)"),
        );
    }

    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
        h(Text, { bold: true, color: theme.primary }, title),
        h(Box, { marginTop: 1 }),
        !items
            ? h(Text, { dimColor: true }, "Carregando...")
            : h(
                  Box,
                  { flexDirection: "column" },
                  rows.length === 0 ? h(Text, { dimColor: true }, "Nenhum item ainda.") : null,
                  ...rows.map((row, i) => {
                      const active = i === cursor;
                      const pointer = active ? c.primary("❯ ") : "  ";
                      const number = i < 9 ? c.muted(`${i + 1}) `) : "   ";
                      const { label, hint } = row.kind === "create" ? { label: createLabel, hint: undefined } : itemLabel(row.item);
                      const styledLabel = active ? c.primary(label) : label;
                      const hintText = hint ? `  ${c.muted(hint)}` : "";
                      return h(Text, { key: row.kind === "create" ? "__create__" : row.item.id }, pointer, number, styledLabel, hintText);
                  }),
              ),
        h(Box, { marginTop: 1 }),
        error ? h(Text, { color: theme.danger }, `Erro: ${error}`) : null,
        h(Text, { dimColor: true }, busy ? "aplicando..." : `1-9, ↑↓+Enter navega${onDelete ? " · x apaga" : ""} · Esc volta`),
    );
}
