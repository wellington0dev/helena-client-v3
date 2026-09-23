import React from "react";
import { Box, Text, useInput } from "ink";
import { Confirm } from "./confirm.ts";
import { EmptyState } from "./empty-state.ts";
import { Loader } from "./loader.ts";
import { c, theme, panel, SPACE } from "./theme.ts";

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
    /** Título da confirmação — default assume "apagar" de verdade (irreversível). Telas que reusam `onDelete` pra outra ação (ex: "restaurar padrão" em `projects-screen.ts`) devem passar um texto específico — nunca deixar o texto genérico mentir sobre o que vai acontecer. */
    deleteConfirmLabel?: (item: Item) => string;
    busy: boolean;
    error?: string;
    onExit: () => void;
    /** Teto de linhas de item mostradas ao mesmo tempo — acima disso a lista rola acompanhando o cursor (telas com listas longas, ex: /sessoes). Ausente = mostra tudo. */
    maxVisible?: number;
}

/** Janela [start, end) de `total` linhas com o cursor o mais centralizado possível. Pura e testada em crud-screen.test.ts. */
export function visibleWindow(total: number, cursor: number, maxVisible: number | undefined): { start: number; end: number } {
    if (!maxVisible || total <= maxVisible) return { start: 0, end: total };
    const start = Math.min(Math.max(cursor - Math.floor(maxVisible / 2), 0), total - maxVisible);
    return { start, end: start + maxVisible };
}

type Row<Item> = { kind: "create" } | { kind: "item"; item: Item };

export function CrudScreen<Item extends { id: string }>(props: CrudScreenProps<Item>): React.ReactElement {
    const { title, items, itemLabel, onSelect, onCreate, createLabel = "+ Criar novo", onDelete, deleteConfirmLabel, busy, error, onExit, maxVisible } = props;
    const [cursor, setCursor] = React.useState(0);
    const [confirming, setConfirming] = React.useState<Item | undefined>(undefined);

    const rows: Row<Item>[] = React.useMemo(() => {
        const itemRows: Row<Item>[] = (items ?? []).map((item) => ({ kind: "item", item }));
        return onCreate ? [{ kind: "create" }, ...itemRows] : itemRows;
    }, [items, onCreate]);

    useInput((input, key) => {
        if (busy || !items) return;
        // Enquanto confirma, quem trata s/n/Esc é o <Confirm> montado abaixo (useInput PRÓPRIO) — nunca os dois ao
        // mesmo tempo, senão a mesma tecla dispara achando de duas fontes (ver comentário em confirm.ts).
        if (confirming) return;

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

    const win = visibleWindow(rows.length, cursor, maxVisible);
    const windowed = Boolean(maxVisible) && rows.length > (maxVisible ?? 0);

    if (confirming) {
        const message = deleteConfirmLabel ? deleteConfirmLabel(confirming) : `Apagar "${itemLabel(confirming).label}"? Essa ação não pode ser desfeita.`;
        const item = confirming;
        return h(Confirm, {
            message,
            onConfirm: () => {
                setConfirming(undefined);
                void onDelete?.(item);
            },
            onCancel: () => setConfirming(undefined),
        });
    }

    return h(
        Box,
        { flexDirection: "column", ...panel("border") },
        h(Text, { bold: true, color: theme.primary }, title),
        h(Box, { marginTop: SPACE.tight }),
        !items
            ? h(Loader, { text: "Carregando..." })
            : h(
                  Box,
                  { flexDirection: "column" },
                  rows.length === 0 ? h(EmptyState, { message: "Nenhum item ainda." }) : null,
                  windowed ? h(Text, { key: "__above__", color: theme.textMuted }, win.start > 0 ? `  ↑ ${win.start} acima` : " ") : null,
                  ...rows.slice(win.start, win.end).map((row, offset) => {
                      const i = win.start + offset;
                      const active = i === cursor;
                      const pointer = active ? c.primary("❯ ") : "  ";
                      const number = i < 9 ? c.muted(`${i + 1}) `) : "   ";
                      const { label, hint } = row.kind === "create" ? { label: createLabel, hint: undefined } : itemLabel(row.item);
                      const styledLabel = active ? c.primary(label) : label;
                      const hintText = hint ? `  ${c.muted(hint)}` : "";
                      return h(Text, { key: row.kind === "create" ? "__create__" : row.item.id, wrap: "truncate" }, pointer, number, styledLabel, hintText);
                  }),
                  windowed ? h(Text, { key: "__below__", color: theme.textMuted }, win.end < rows.length ? `  ↓ ${rows.length - win.end} abaixo` : " ") : null,
              ),
        h(Box, { marginTop: SPACE.tight }),
        error ? h(Text, { color: theme.danger }, `Erro: ${error}`) : null,
        h(Text, { color: theme.textMuted }, busy ? "aplicando..." : `1-9, ↑↓+Enter navega${onDelete ? " · x apaga" : ""} · Esc volta`),
    );
}
