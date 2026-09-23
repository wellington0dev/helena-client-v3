import React from "react";
import { Box, Text } from "ink";
import { SPACE, theme } from "./theme.ts";

const h = React.createElement;

export interface TabItem<T extends string> {
    id: T;
    label: string;
}

export interface TabsProps<T extends string> {
    tabs: TabItem<T>[];
    activeId: T;
}

/**
 * Tira de abas — nenhuma tela usa isto ainda (2026-09-23), nenhuma tela tem abas hoje. Só apresentação: quem monta
 * controla `activeId` e troca de aba (ex: `←`/`→` ou dígito no `useInput` de quem usa) — mesmo motivo de `Details`
 * não ter `useInput` próprio.
 */
export function Tabs<T extends string>(props: TabsProps<T>): React.ReactElement {
    const { tabs, activeId } = props;
    return h(Box, { gap: SPACE.loose }, ...tabs.map((tab) => h(Text, { key: tab.id, bold: tab.id === activeId, color: tab.id === activeId ? theme.primary : theme.textMuted }, tab.label)));
}
