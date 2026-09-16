import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { c, theme } from "./theme.ts";

const h = React.createElement;

/**
 * Formulário genérico de múltiplos campos de texto — antes cada tela
 * inline seu próprio `TextInput` solto (ex: nome do token em
 * `config-screen.ts`). Campos booleanos (ex: `gitPushAllowed`) usam texto
 * livre "s/n", NUNCA um `SelectMenu` de dígito junto de um campo com foco
 * — só um componente interativo montado por vez (mesma regra do
 * `CrudScreen`, ver crud-screen.ts), senão dígito digitado no campo de
 * texto dispararia item de outro menu (useInput é global no processo, não
 * escopado a foco).
 */
export interface FormField {
    key: string;
    label: string;
    initialValue?: string;
    /** Reusa o `mask` nativo do ink-text-input (substitui cada caractere por este) — nenhum campo hoje precisa, mas fica pronto. */
    mask?: string;
    optional?: boolean;
}

export interface FormProps {
    title?: string;
    fields: FormField[];
    onSubmit: (values: Record<string, string>) => void;
    onCancel: () => void;
    submitLabel?: string;
    busy?: boolean;
    error?: string;
}

export function Form(props: FormProps): React.ReactElement {
    const { title, fields, onSubmit, onCancel, submitLabel = "Enter confirma", busy = false, error } = props;
    const [values, setValues] = React.useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.initialValue ?? ""])));
    const [current, setCurrent] = React.useState(0);

    useInput((_input, key) => {
        if (busy) return;
        if (key.escape) {
            onCancel();
            return;
        }
        if (key.tab && key.shift) {
            setCurrent((i) => (i - 1 + fields.length) % fields.length);
            return;
        }
        if (key.tab || key.downArrow) {
            setCurrent((i) => (i + 1) % fields.length);
            return;
        }
        if (key.upArrow) {
            setCurrent((i) => (i - 1 + fields.length) % fields.length);
        }
    });

    function handleFieldSubmit(): void {
        if (current < fields.length - 1) {
            setCurrent((i) => i + 1);
        } else {
            onSubmit(values);
        }
    }

    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
        title ? h(Text, { bold: true, color: theme.primary }, title) : null,
        title ? h(Box, { marginTop: 1 }) : null,
        ...fields.map((field, i) =>
            h(
                Box,
                { key: field.key, gap: 1 },
                h(Text, null, `${field.label}${field.optional ? c.muted(" (opcional)") : ""}:`),
                h(TextInput, {
                    value: values[field.key] ?? "",
                    onChange: (v: string) => setValues((prev) => ({ ...prev, [field.key]: v })),
                    onSubmit: handleFieldSubmit,
                    focus: !busy && i === current,
                    mask: field.mask,
                }),
            ),
        ),
        h(Box, { marginTop: 1 }),
        error ? h(Text, { color: theme.danger }, `Erro: ${error}`) : null,
        h(Text, { dimColor: true }, busy ? "enviando..." : `Tab/↑↓ troca campo · ${submitLabel} · Esc cancela`),
    );
}
