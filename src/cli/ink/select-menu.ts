import React from "react";
import { Box, Text, useInput } from "ink";
import { c } from "./theme.ts";

const h = React.createElement;

/**
 * Primitivo reusado por toda tela do CLI que precisa de navegação em lista
 * (config, tokens de API, e as próximas — Projects/Contatos/Integrações/
 * Canais). Sem dependência nova (`ink-select-input`): ↑↓/Enter dão conta
 * do recado — E cada item também aceita o DÍGITO dele direto (1-9), sem
 * precisar navegar primeiro. Isso não é só conveniência: achado ao vivo
 * testando via pty de verdade que sequência de escape de várias bytes
 * (seta, `\x1b[B`) pode chegar fragmentada e não ser reconstruída a
 * tempo dependendo do terminal/multiplexador — dígito único (1 byte) não
 * tem essa classe de problema, então é o caminho garantido, com setas
 * como atalho extra pra quem preferir.
 */
export interface SelectMenuItem<T> {
    label: string;
    value: T;
    /** Texto discreto à direita do label (ex: "ligado"/"desligado") — nunca a própria seleção, só contexto. */
    hint?: string;
    disabled?: boolean;
}

const DIGIT_KEYS = "123456789";

export function SelectMenu<T>(props: { items: SelectMenuItem<T>[]; onSelect: (value: T) => void; onCancel?: () => void }): React.ReactElement {
    const { items, onSelect, onCancel } = props;
    const [cursor, setCursor] = React.useState(0);

    useInput((input, key) => {
        if (key.upArrow) {
            setCursor((c) => (c - 1 + items.length) % items.length);
            return;
        }
        if (key.downArrow) {
            setCursor((c) => (c + 1) % items.length);
            return;
        }
        if (key.return) {
            const item = items[cursor];
            if (item && !item.disabled) onSelect(item.value);
            return;
        }
        if (key.escape) {
            onCancel?.();
            return;
        }
        const digitIndex = DIGIT_KEYS.indexOf(input);
        if (digitIndex !== -1 && digitIndex < items.length) {
            const item = items[digitIndex];
            if (item && !item.disabled) onSelect(item.value);
        }
    });

    return h(
        Box,
        { flexDirection: "column" },
        ...items.map((item, i) => {
            const active = i === cursor;
            const pointer = active ? c.primary("❯ ") : "  ";
            const number = i < 9 ? c.muted(`${i + 1}) `) : "   ";
            const label = item.disabled ? c.muted(item.label) : active ? c.primary(item.label) : item.label;
            const hint = item.hint ? `  ${c.muted(item.hint)}` : "";
            return h(Text, { key: i }, pointer, number, label, hint);
        }),
    );
}
