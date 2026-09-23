import React from "react";
import { Text } from "ink";
import { Badge } from "./badge.ts";
import { theme } from "./theme.ts";

const h = React.createElement;

/**
 * Pill "● ligado / ○ desligado" — instância do `Badge` genérico (ver badge.ts), extraída de `valuePill` em
 * `settings-modal.ts` (única tela com toggle até 2026-09-23). `undefined` = ainda carregando/indisponível (nem
 * ligado nem desligado — não confundir com `false`).
 */
export function Checkbox(props: { value: boolean | undefined; busy?: boolean }): React.ReactElement {
    const { value, busy = false } = props;
    if (busy || value === undefined) return h(Text, { color: theme.textMuted }, " … ");
    return h(Badge, value ? { tone: "success", label: "● ligado" } : { tone: "muted", label: "○ desligado" });
}
