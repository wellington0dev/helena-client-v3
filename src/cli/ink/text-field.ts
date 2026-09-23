import React from "react";
import { Box, Text } from "ink";
import TextInput from "./text-input.ts";
import { stripMouse } from "./mouse.ts";
import { c, SPACE } from "./theme.ts";

const h = React.createElement;

export interface TextFieldProps {
    label: string;
    /** Mostra "(opcional)" discreto depois do rótulo — só texto, não muda validação (quem valida é quem monta). */
    optional?: boolean;
    value: string;
    onChange: (value: string) => void;
    onSubmit?: () => void;
    /** Default `true` — um campo solto fora de `Form` normalmente É o único campo da tela. */
    focus?: boolean;
    /** Reusa o `mask` nativo do TextInput (substitui cada caractere por este) — ex: senha. */
    mask?: string;
}

/**
 * Rótulo + `TextInput` (fork de ink-text-input, ver text-input.ts), lado a lado — extraído de `form.ts` (única tela com campo de texto até 2026-09-23),
 * pra dar pra usar um campo solto fora de um formulário de múltiplos campos. `stripMouse` sempre aplicado: um
 * toque rápido no trackpad pode entregar sequência de mouse como se fosse texto digitado (ver mouse.ts).
 */
export function TextField(props: TextFieldProps): React.ReactElement {
    const { label, optional, value, onChange, onSubmit, focus = true, mask } = props;
    return h(
        Box,
        { gap: SPACE.tight },
        h(Text, null, `${label}${optional ? c.muted(" (opcional)") : ""}:`),
        h(TextInput, { value, onChange: (v: string) => onChange(stripMouse(v)), onSubmit, focus, mask }),
    );
}
