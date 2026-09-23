import React from "react";
import { Text } from "ink";
import { bg, theme } from "./theme.ts";

const h = React.createElement;

export type BadgeTone = "success" | "danger" | "warn" | "muted";

const BADGE_COLOR: Record<BadgeTone, { background: string; color: string }> = {
    success: { background: bg.success, color: theme.success },
    danger: { background: bg.danger, color: theme.danger },
    warn: { background: bg.warning, color: theme.warning },
    muted: { background: bg.surface, color: theme.textMuted },
};

/**
 * Selo de status curto, fundo colorido por tom — generaliza o pill "● ligado/○ desligado" que só existia dentro do
 * `Checkbox` (ver checkbox.ts, que agora é uma instância disto). Pensado pra estado curto e discreto (conectado/
 * desconectado, ligado/desligado) — pra um AVISO de uma linha inteira, use `Banner` (banner.ts), não isto.
 */
export function Badge(props: { tone: BadgeTone; label: string }): React.ReactElement {
    const { tone, label } = props;
    const style = BADGE_COLOR[tone];
    return h(Text, { backgroundColor: style.background, color: style.color }, ` ${label} `);
}
