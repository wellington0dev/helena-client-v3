import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { getMachineMetrics, getTelemetryLogs, type MachineMetric, type TelemetryLogEntry } from "../api/telemetry.ts";
import { METRICS_INTERVAL_MS } from "../../machine-metrics.ts";
import { UnauthorizedError } from "../backend.ts";
import { CrudScreen } from "./crud-screen.ts";
import { ErrorPanel } from "./error-panel.ts";
import { Badge } from "./badge.ts";
import { Loader } from "./loader.ts";
import { formatWhen } from "./sessions-screen.ts";
import { c, theme, panel, SPACE } from "./theme.ts";

const h = React.createElement;

const TelemetryCrudScreen = CrudScreen as unknown as (props: {
    title: string;
    items: TelemetryLogEntry[] | undefined;
    itemLabel: (item: TelemetryLogEntry) => { label: string; hint?: string };
    onSelect: (item: TelemetryLogEntry) => void;
    busy: boolean;
    onExit: () => void;
    maxVisible?: number;
}) => React.ReactElement;

const LEVEL_COLOR: Record<string, (s: string) => string> = { error: c.danger, warn: c.warning, info: c.muted, performance: c.success };

export function telemetryLabel(entry: TelemetryLogEntry): { label: string; hint: string } {
    const colorize = LEVEL_COLOR[entry.level] ?? c.muted;
    const firstLine = entry.message.split("\n")[0]!;
    return { label: `${colorize(`[${entry.level}]`)} ${firstLine}`, hint: `${formatWhen(entry.timestamp)} · ${entry.source ?? "?"}` };
}

/** Stack cru pode ter dezenas de linhas — corta pra não estourar a tela (mesmo espírito de format-tool-call.ts truncando saída de tool). */
export function truncateStack(stack: string, maxLines = 15): string {
    const lines = stack.split("\n");
    if (lines.length <= maxLines) return stack;
    return `${lines.slice(0, maxLines).join("\n")}\n… (+${lines.length - maxLines} linhas)`;
}


/** "3d 4h", "2h 5m", "45s" — só as duas maiores unidades, o suficiente pra ler de relance. */
export function formatDuration(totalSec: number): string {
    const sec = Math.max(0, Math.floor(totalSec));
    const d = Math.floor(sec / 86400);
    const hr = Math.floor((sec % 86400) / 3600);
    const min = Math.floor((sec % 3600) / 60);
    if (d > 0) return `${d}d ${hr}h`;
    if (hr > 0) return `${hr}h ${min}m`;
    if (min > 0) return `${min}m`;
    return `${sec}s`;
}

/** Sem reportar há mais de 2 ciclos do coletor = daemon parado/máquina off (não é erro, só dado velho). */
export function isStaleMetric(updatedAt: string, now = Date.now()): boolean {
    return now - new Date(updatedAt).getTime() > 2 * METRICS_INTERVAL_MS;
}

export function machineLine(metric: MachineMetric): string {
    return `${metric.machineName}  CPU ${metric.cpuPercent}% · RAM ${metric.rssMb} MB (heap ${metric.heapUsedMb} MB) · daemon ${formatDuration(metric.processUptimeSec)} · máquina ${formatDuration(metric.machineUptimeSec)}`;
}

function MachinesPanel({ machines }: { machines: MachineMetric[] | undefined }): React.ReactElement {
    return h(
        Box,
        { flexDirection: "column", ...panel("border"), marginBottom: SPACE.tight },
        h(Text, { bold: true, color: theme.primary }, "Helena por máquina — CPU/RAM do processo e tempo ativo"),
        !machines
            ? h(Loader, { text: "Carregando máquinas..." })
            : machines.length === 0
              ? h(Text, { color: theme.textMuted }, "Nenhuma máquina reportou ainda (o daemon reporta a cada minuto, com telemetria ligada em /config).")
              : h(
                    Box,
                    { flexDirection: "column" },
                    ...machines.map((m) =>
                        h(
                            Box,
                            { key: m.id, gap: SPACE.tight },
                            h(Text, { wrap: "truncate" }, machineLine(m)),
                            isStaleMetric(m.updatedAt) ? h(Badge, { tone: "warn", label: `sem sinal · ${formatWhen(m.updatedAt)}` }) : h(Badge, { tone: "success", label: "online" }),
                        ),
                    ),
                ),
    );
}

type ScreenState = { kind: "list" } | { kind: "detail"; entry: TelemetryLogEntry };

/**
 * `/telemetria` — CPU/RAM do processo do daemon + uptime, por máquina do PRÓPRIO dono (qualquer conta) + visão de OPERADOR (`GET /telemetry/logs`, `AdminGuard` no backend) dos logs de erro/aviso que o
 * próprio `client/`/`cli` reportam voluntariamente (ver telemetry.ts) — nasce SEM tela nenhuma pra ver isso desde
 * que o painel Angular (único consumidor antigo dessa rota) foi removido: os dados chegavam a acontecer e a
 * gravar direitinho, mas ficavam invisíveis (achado ao vivo, 2026-09-23 — consulta direta no banco confirmou
 * consentimento ligado e 26 registros reais, sem NENHUMA tela pra ler). Read-only de propósito (nem editar nem
 * apagar um log de erro faz sentido); conta que não é admin recebe o 403 do backend como erro normal aqui, sem
 * tratamento especial — não vale a pena esconder o comando pra quem não tem a role (o app é essencialmente
 * single-owner, e o dono já É admin).
 */
export function TelemetryScreen(props: { backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized } = props;
    const [logs, setLogs] = React.useState<TelemetryLogEntry[] | undefined>(undefined);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [machines, setMachines] = React.useState<MachineMetric[] | undefined>(undefined);
    const [screen, setScreen] = React.useState<ScreenState>({ kind: "list" });
    const { rows } = useWindowSize();

    React.useEffect(() => {
        // Independente dos logs (que exigem admin): o dono vê o consumo da Helena nas próprias máquinas mesmo sem a role.
        // Recarrega a cada meio ciclo do coletor — tela de monitoramento aberta não pode congelar no primeiro snapshot
        // (nem o badge "online"/"sem sinal", que só é recalculado a cada render).
        const load = (): void => {
            getMachineMetrics(backendUrl, token)
                .then(setMachines)
                .catch((err: unknown) => {
                    if (err instanceof UnauthorizedError) onUnauthorized();
                    else setMachines((prev) => prev ?? []);
                });
        };
        load();
        const timer = setInterval(load, METRICS_INTERVAL_MS / 2);
        return () => clearInterval(timer);
    }, [backendUrl, token]);

    React.useEffect(() => {
        getTelemetryLogs(backendUrl, token)
            .then(setLogs)
            .catch((err: unknown) => {
                if (err instanceof UnauthorizedError) {
                    onUnauthorized();
                    return;
                }
                setError(err instanceof Error ? err.message : String(err));
            });
    }, [backendUrl, token]);

    // Erro nos logs (ex: 403, conta sem role admin) NÃO esconde as máquinas — só troca a lista. Sem este Esc próprio a
    // tela travaria: o CrudScreen (que normalmente trata Esc) nem chega a montar quando há erro.
    useInput((_input, key) => {
        if (error && key.escape) onExit();
    });

    if (screen.kind === "detail") {
        return h(TelemetryDetailScreen, { entry: screen.entry, onBack: () => setScreen({ kind: "list" }) });
    }

    // moldura do painel de máquinas (2 padding + título + margem) + 1 linha por máquina; o resto da altura vai pra lista
    const machinesRows = 4 + Math.max(1, machines?.length ?? 1) + SPACE.tight;
    return h(
        Box,
        { flexDirection: "column" },
        h(MachinesPanel, { machines }),
        error
            ? h(ErrorPanel, { error: `logs de telemetria: ${error}` })
            : h(TelemetryCrudScreen, {
                  title: "Telemetria — erros/avisos reportados voluntariamente (ver consentimento em /config)",
                  items: logs,
                  itemLabel: telemetryLabel,
                  onSelect: (entry) => setScreen({ kind: "detail", entry }),
                  busy: false,
                  onExit,
                  maxVisible: Math.max(3, rows - 11 - machinesRows),
              }),
    );
}

function TelemetryDetailScreen(props: { entry: TelemetryLogEntry; onBack: () => void }): React.ReactElement {
    const { entry, onBack } = props;

    useInput((_input, key) => {
        if (key.escape) onBack();
    });

    return h(
        Box,
        { flexDirection: "column", ...panel("border") },
        h(Text, { bold: true, color: theme.primary }, `${entry.level.toUpperCase()} — ${formatWhen(entry.timestamp)}`),
        h(Text, { color: theme.textMuted }, `${entry.source ?? "origem desconhecida"} · v${entry.appVersion ?? "?"} · ${entry.userEmail ?? entry.userId}`),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, null, entry.message),
        entry.stack ? h(Box, { flexDirection: "column", marginTop: SPACE.tight }, h(Text, { color: theme.textMuted }, "Stack:"), h(Text, { color: theme.textMuted }, truncateStack(entry.stack))) : null,
        entry.context ? h(Box, { flexDirection: "column", marginTop: SPACE.tight }, h(Text, { color: theme.textMuted }, "Contexto:"), h(Text, { color: theme.textMuted }, JSON.stringify(entry.context))) : null,
        h(Box, { marginTop: SPACE.tight }),
        h(Text, { color: theme.textMuted }, "Esc volta"),
    );
}
