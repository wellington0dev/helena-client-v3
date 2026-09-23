import React from "react";
import { Box, Text } from "ink";
import { bg, MESSAGE_PADDING_X, SPACE, theme } from "./theme.ts";

const h = React.createElement;

/** Mesmo vocabulário de tom usado em toda parte do app (`noticeItem`, `pushNotice` do `CommandContext`, etc). */
export type BannerTone = "success" | "warn" | "danger" | "info";

const BANNER_COLOR: Record<BannerTone, { background: string; color?: string }> = {
    success: { background: bg.success, color: theme.success },
    danger: { background: bg.danger, color: theme.danger },
    warn: { background: bg.warning, color: theme.warning },
    info: { background: bg.surface },
};

/**
 * Bloco de fundo colorido por tom (sem borda — ver theme.ts) — extraído de `HistoryLine` em app.ts, onde
 * `noticeItem` já desenhava exatamente isto (única tela com aviso por tom até 2026-09-23). `paddingY` default 0:
 * avisos de uma linha ficam como faixa, sem respiro vertical (ver `NOTICE_PADDING_Y`) — quem precisar de mais
 * respiro passa `SPACE.tight`.
 */
export function Banner(props: { tone: BannerTone; text: string; paddingY?: number }): React.ReactElement {
    const { tone, text, paddingY = SPACE.none } = props;
    const style = BANNER_COLOR[tone];
    return h(Box, { backgroundColor: style.background, paddingX: MESSAGE_PADDING_X, paddingY }, h(Text, { color: style.color }, text));
}
