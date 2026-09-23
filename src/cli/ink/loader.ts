import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { SPACE, theme } from "./theme.ts";

const h = React.createElement;

/**
 * Spinner + texto opcional — extraído de `StatusLine` em app.ts (única tela com spinner até 2026-09-23). Sem
 * `text`, é só o spinner sozinho (ex: um item de lista carregando, sem linha de status inteira pra ele).
 */
export function Loader(props: { text?: string }): React.ReactElement {
    const { text } = props;
    const spinner = h(Text, { color: theme.primary }, h(Spinner, { type: "dots" }));
    if (text === undefined) return spinner;
    return h(Box, { gap: SPACE.tight }, spinner, h(Text, { color: theme.textMuted }, text));
}
