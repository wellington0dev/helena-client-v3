import React from "react";
import { Box, Text, useInput } from "ink";
import type { PendingConfirmation } from "../backend.ts";
import { theme, panel } from "./theme.ts";
import { countWrappedLines } from "./viewport.ts";

/**
 * Diálogo de permissão (estilo Claude Code) pra uma tool que parou pedindo confirmação:
 *   1. Sim, só desta vez          → aprova sem gravar nada (`remember:false`)
 *   2. Sim, e sempre permitir     → aprova e grava o comando EXATO na allowlist do backend (`remember:true`)
 *   3. Não                        → recusa
 * "Sempre permitir" só existe pra `shell` — é a única tool que o backend aprende (ver
 * ChatService#resolveInterrupt / commandToRememberOnApproval); pras outras o diálogo mostra só 1 e 3.
 *
 * `permissionView` é a fonte ÚNICA do texto: o componente desenha a partir dela e
 * `measurePermissionDialog` mede a MESMA coisa (o chat é fullscreen e orça as linhas na mão,
 * ver viewport.ts) — se o layout mudar aqui, o teste em permission-dialog.test.ts pega.
 */
const h = React.createElement;

export type PermissionDecision = "once" | "always" | "reject";

export interface PermissionOption {
    decision: PermissionDecision;
    label: string;
}

export interface PermissionView {
    title: string;
    /** Linha em destaque (o comando, ou o JSON do input pra outras tools). */
    primary: string;
    /** Linha de contexto (máquina, diretório, background) — vazia quando não há nada. */
    context: string;
    question: string;
    options: PermissionOption[];
    hint: string;
}

const TOOL_LABELS: Record<string, string> = { shell: "Bash" };

export function permissionView(pending: PendingConfirmation): PermissionView {
    const input = pending.input && typeof pending.input === "object" ? (pending.input as Record<string, unknown>) : {};
    const isShell = pending.tool === "shell" && typeof input.command === "string";

    const contextParts: string[] = [];
    if (isShell) {
        if (typeof input.machine === "string" && input.machine) contextParts.push(input.machine);
        if (typeof input.cwd === "string" && input.cwd) contextParts.push(`em ${input.cwd}`);
        if (input.background === true) contextParts.push("em segundo plano");
    }

    const options: PermissionOption[] = [{ decision: "once", label: "Sim, só desta vez" }];
    if (isShell) options.push({ decision: "always", label: "Sim, e sempre permitir este comando exato" });
    options.push({ decision: "reject", label: "Não" });

    return {
        title: `Permissão necessária · ${TOOL_LABELS[pending.tool] ?? pending.tool}`,
        primary: isShell ? `$ ${input.command as string}` : JSON.stringify(pending.input, null, 2),
        context: contextParts.join(" · "),
        question: "Deseja permitir?",
        options,
        hint: "↑↓ navegar · Enter confirmar · 1-" + options.length + " atalho · Esc recusa",
    };
}

/** Colunas úteis dentro da caixa (borda + padding + margem de segurança — superestimar linhas é seguro, ver viewport.ts). */
function innerWidth(columns: number): number {
    return Math.max(1, columns - 6);
}

function optionText(option: PermissionOption, index: number): string {
    return `❯ ${index + 1}. ${option.label}`;
}

export function measurePermissionDialog(pending: PendingConfirmation, columns: number): number {
    const view = permissionView(pending);
    const inner = innerWidth(columns);
    let rows = 2; // bordas
    rows += countWrappedLines(view.title, inner);
    rows += countWrappedLines(view.primary, inner);
    if (view.context) rows += countWrappedLines(view.context, inner);
    rows += 1; // linha em branco antes da pergunta
    rows += countWrappedLines(view.question, inner);
    for (let i = 0; i < view.options.length; i++) rows += countWrappedLines(optionText(view.options[i]!, i), inner);
    rows += countWrappedLines(view.hint, inner);
    return rows;
}

export function PermissionDialog(props: { pending: PendingConfirmation; onAnswer: (decision: PermissionDecision) => void }): React.ReactElement {
    const view = permissionView(props.pending);
    const [selected, setSelected] = React.useState(0);
    const count = view.options.length;

    useInput((input: string, key: { upArrow?: boolean; downArrow?: boolean; tab?: boolean; return?: boolean; escape?: boolean; shift?: boolean }) => {
        if (key.upArrow || (key.tab && key.shift)) {
            setSelected((i) => (i - 1 + count) % count);
        } else if (key.downArrow || key.tab) {
            setSelected((i) => (i + 1) % count);
        } else if (key.return) {
            props.onAnswer(view.options[selected]!.decision);
        } else if (key.escape) {
            props.onAnswer("reject");
        } else if (/^[1-9]$/.test(input)) {
            const option = view.options[Number(input) - 1];
            if (option) props.onAnswer(option.decision);
        } else if (input.toLowerCase() === "n") {
            props.onAnswer("reject");
        } else if (input.toLowerCase() === "s" || input.toLowerCase() === "y") {
            props.onAnswer("once");
        }
    });

    return h(
        Box,
        { flexDirection: "column", ...panel("warning") },
        h(Text, { color: theme.warning, bold: true }, view.title),
        h(Text, { bold: true }, view.primary),
        view.context ? h(Text, { color: theme.textMuted }, view.context) : null,
        h(Text, null, " "),
        h(Text, null, view.question),
        ...view.options.map((option, i) =>
            i === selected
                ? h(Text, { key: option.decision, color: theme.primary, bold: true }, optionText(option, i))
                : h(Text, { key: option.decision, color: theme.textMuted }, `  ${i + 1}. ${option.label}`),
        ),
        h(Text, { color: theme.textMuted }, view.hint),
    );
}
