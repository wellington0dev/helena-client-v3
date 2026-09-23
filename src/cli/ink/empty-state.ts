import React from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.ts";

const h = React.createElement;

/**
 * Mensagem de "nada aqui ainda" — cada lista escrevia a própria frase solta (`crud-screen.ts`: "Nenhum item
 * ainda."). `hint` é uma segunda linha opcional (ex: como criar o primeiro item) — sempre muted, nunca compete
 * visualmente com o conteúdo de verdade.
 */
export function EmptyState(props: { message: string; hint?: string }): React.ReactElement {
    const { message, hint } = props;
    return h(Box, { flexDirection: "column" }, h(Text, { color: theme.textMuted }, message), hint ? h(Text, { color: theme.textMuted }, hint) : null);
}
