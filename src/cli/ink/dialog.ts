import React from "react";
import { Box, Text, useInput } from "ink";
import { panel, theme } from "./theme.ts";

const h = React.createElement;

export interface DialogOption<V> {
    value: V;
    label: string;
}

export interface DialogProps<V> {
    title: string;
    /** Linha em destaque (ex: o comando de um `shell`, ou o JSON de outra tool). */
    primary: string;
    /** Linha de contexto opcional (ex: máquina/diretório). */
    context?: string;
    question: string;
    options: DialogOption<V>[];
    hint: string;
    onAnswer: (value: V) => void;
    /** Esc — ausente = Esc não faz nada (raro; a maioria dos diálogos quer cancelar/recusar por Esc). */
    onCancel?: () => void;
}

/**
 * Diálogo de múltiplas opções numeradas (estilo Claude Code) — generalização de `permission-dialog.ts`, único
 * consumidor até 2026-09-23. `↑↓`/Tab navegam, Enter confirma a destacada, dígito 1-9 escolhe direto. Atalhos
 * ESPECÍFICOS de uma tela (ex: "s"/"n"/"y" do diálogo de permissão) NÃO entram aqui — quem monta adiciona o
 * próprio `useInput` por cima, em teclas que não colidem com as de navegação (ver permission-dialog.ts).
 */
export function Dialog<V>(props: DialogProps<V>): React.ReactElement {
    const { title, primary, context, question, options, hint, onAnswer, onCancel } = props;
    const [selected, setSelected] = React.useState(0);
    const count = options.length;

    useInput((input, key) => {
        if (key.upArrow || (key.tab && key.shift)) {
            setSelected((i) => (i - 1 + count) % count);
        } else if (key.downArrow || key.tab) {
            setSelected((i) => (i + 1) % count);
        } else if (key.return) {
            onAnswer(options[selected]!.value);
        } else if (key.escape) {
            onCancel?.();
        } else if (/^[1-9]$/.test(input)) {
            const option = options[Number(input) - 1];
            if (option) onAnswer(option.value);
        }
    });

    return h(
        Box,
        { flexDirection: "column", ...panel("warning") },
        h(Text, { color: theme.warning, bold: true }, title),
        h(Text, { bold: true }, primary),
        context ? h(Text, { color: theme.textMuted }, context) : null,
        h(Text, null, " "),
        h(Text, null, question),
        ...options.map((option, i) =>
            i === selected ? h(Text, { key: i, color: theme.primary, bold: true }, `❯ ${i + 1}. ${option.label}`) : h(Text, { key: i, color: theme.textMuted }, `  ${i + 1}. ${option.label}`),
        ),
        h(Text, { color: theme.textMuted }, hint),
    );
}
