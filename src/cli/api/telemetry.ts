import { authed } from "./http.ts";

/** Espelha `TelemetryLogEntryWithUser` (backend-v2 `telemetry.service.ts`) — `GET /telemetry/logs`, visão de OPERADOR (`AdminGuard`), nunca do próprio usuário lendo os próprios logs. */
export interface TelemetryLogEntry {
    id: string;
    userId: string;
    userEmail: string | null;
    userDisplayName: string | null;
    timestamp: string;
    /** "error" | "warn" | "info" | "performance" — string solta, mesmo motivo de portabilidade da entidade (ver telemetry-log-entry.entity.ts). */
    level: string;
    message: string;
    stack?: string;
    source?: string;
    appVersion?: string;
    context?: Record<string, unknown>;
}

export function getTelemetryLogs(baseUrl: string, token: string, limit = 100): Promise<TelemetryLogEntry[]> {
    return authed(baseUrl, token, "GET", `/telemetry/logs?limit=${limit}`);
}

/** Espelha `MachineMetric` (backend-v2 `machine-metrics`) — `GET /machine-metrics`: consumo do processo do daemon (CPU/RSS/heap) + uptime, por máquina do PRÓPRIO usuário (JWT normal, não admin). `updatedAt` = última vez que a máquina reportou. */
export interface MachineMetric {
    id: string;
    machineName: string;
    cpuPercent: number;
    rssMb: number;
    heapUsedMb: number;
    processUptimeSec: number;
    machineUptimeSec: number;
    platform?: string;
    updatedAt: string;
}

export function getMachineMetrics(baseUrl: string, token: string): Promise<MachineMetric[]> {
    return authed(baseUrl, token, "GET", "/machine-metrics");
}
