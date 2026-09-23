import React from "react";
import { Box, Text } from "ink";
import { SPACE, theme } from "./theme.ts";

const h = React.createElement;

export interface DetailsProps {
    summary: string;
    open: boolean;
    /** Linhas do corpo — só desenhadas quando `open`. */
    children: string[];
}

/**
 * Seção expansível, no espírito do `<details>`/`<summary>` do HTML — nenhuma tela usa isto ainda (2026-09-23).
 * Propositalmente CONTROLADO (`open`/sem `useInput` próprio): um `Details` que decidisse abrir/fechar sozinho no
 * Enter quebraria com mais de uma instância na tela — o `useInput` do Ink entrega a tecla pra TODO hook ativo (ver
 * mesmo cuidado em confirm.ts/app.ts#Ctrl+P), então TODOS abririam/fechariam juntos. Quem monta decide QUANDO
 * alternar (ex: Enter no item selecionado de uma lista que já sabe qual item está com foco).
 */
export function Details(props: DetailsProps): React.ReactElement {
    const { summary, open, children } = props;
    return h(
        Box,
        { flexDirection: "column" },
        h(Text, null, `${open ? "▾" : "▸"} ${summary}`),
        ...(open ? children.map((line, i) => h(Text, { key: i, color: theme.textMuted }, `${" ".repeat(SPACE.loose)}${line}`)) : []),
    );
}
