import React from "react";
import { Text } from "ink";
import { theme } from "./theme.ts";

const h = React.createElement;

/**
 * Dica contextual — nenhuma tela usa isto ainda (2026-09-23). Limitação honesta: um terminal não tem overlay que
 * segue o mouse/cursor, então isto NÃO é um balão flutuante — é só texto muted que aparece/some junto de `active`
 * (ex: linha selecionada de uma lista). Pra um rodapé de dica FIXO (sempre visível, não condicional), continue
 * escrevendo o `Text` direto — isto é só pra dica que depende de estado (foco/seleção/hover).
 */
export function Tooltip(props: { text: string; active: boolean }): React.ReactElement | null {
    const { text, active } = props;
    if (!active) return null;
    return h(Text, { color: theme.textMuted }, text);
}
