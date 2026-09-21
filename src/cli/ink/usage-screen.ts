import React from "react";
import { Box, Text, useInput } from "ink";
import { getUsage, type UsageSummary } from "../api/usage.ts";
import { UnauthorizedError } from "../backend.ts";
import { buildUsageView } from "./usage-view.ts";
import { c, theme, panel } from "./theme.ts";

const h = React.createElement;

const BAR_HEIGHT_ROWS = 6;

/** `/uso` — read-only, uma chamada só (`GET /dashboard/usage`). Conta CHAMADAS, não tokens/R$ (isso é `/cobranca`). */
export function UsageScreen(props: { backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized } = props;
    const [usage, setUsage] = React.useState<UsageSummary | undefined>(undefined);
    const [error, setError] = React.useState<string | undefined>(undefined);

    useInput((_input, key) => {
        if (key.escape) onExit();
    });

    React.useEffect(() => {
        getUsage(backendUrl, token)
            .then(setUsage)
            .catch((err) => {
                if (err instanceof UnauthorizedError) {
                    onUnauthorized();
                    return;
                }
                setError(err instanceof Error ? err.message : String(err));
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    if (error) {
        return h(Text, { color: theme.danger }, `Erro: ${error} — Esc pra voltar ao chat`);
    }
    if (!usage) {
        return h(Text, { color: theme.textMuted }, "Carregando uso...");
    }

    const { channelTiles, weekBars } = buildUsageView(usage);

    return h(
        Box,
        { flexDirection: "column", ...panel("border") },
        h(Text, { bold: true, color: theme.primary }, "Uso — chamadas de chat"),
        h(Text, { color: theme.textMuted }, `Total: ${usage.totalCalls}${usage.firstCallAt ? ` · desde ${new Date(usage.firstCallAt).toLocaleDateString("pt-BR")}` : ""}`),
        h(Box, { marginTop: 1, gap: 3 }, ...channelTiles.map((tile) => h(Text, { key: tile.key }, `${tile.label}: `, c.primary.bold(String(tile.value))))),
        h(Box, { marginTop: 1 }),
        h(Text, { color: theme.textMuted }, "Últimos 7 dias:"),
        h(
            Box,
            { flexDirection: "row", gap: 1, marginTop: 1, alignItems: "flex-end" },
            ...weekBars.map((bar) => {
                const rows = Math.max(1, Math.round((bar.heightPct / 100) * BAR_HEIGHT_ROWS));
                return h(
                    Box,
                    { key: bar.date, flexDirection: "column", alignItems: "center" },
                    ...Array.from({ length: BAR_HEIGHT_ROWS - rows }, (_, i) => h(Text, { key: `blank-${i}` }, " ")),
                    ...Array.from({ length: rows }, (_, i) => h(Text, { key: `bar-${i}`, color: theme.primary }, "██")),
                    h(Text, { color: theme.textMuted }, bar.label),
                    h(Text, { color: theme.textMuted }, String(bar.calls)),
                );
            }),
        ),
        h(Box, { marginTop: 1 }),
        h(Text, { color: theme.textMuted }, "Esc volta"),
    );
}
