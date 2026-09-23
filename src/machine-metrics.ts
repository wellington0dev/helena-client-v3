import os from "node:os";
import { config } from "./config.ts";

/**
 * Snapshot periódico de consumo do PROCESSO do daemon (`main.ts`) — CPU e RAM do próprio processo da Helena, nunca
 * da máquina inteira (pedido do dono: o que interessa é quanto a Helena pesa, e RSS/heap subindo sem voltar é o
 * sinal de vazamento que a máquina inteira esconderia). Emissor PRÓPRIO, separado de `telemetry.ts` de propósito:
 * aquele tem teto de 20 relatos por nível e nunca repete a mesma mensagem — um snapshot periódico ali esgotaria o
 * teto em horas. Aqui não existe contador nem dedupe: cada envio é um upsert (`POST /machine-metrics`, ver
 * backend-v2 `machine-metrics.service.ts`) que sobrescreve a leitura anterior da mesma máquina — nunca vira log.
 *
 * Só roda no daemon (vida longa) — o `helena` CLI abre e fecha por sessão, uptime dele não significaria nada.
 * Mesmo consentimento da telemetria de erro (`User.telemetryConsent`): sem ele o backend responde 403 e este
 * emissor simplesmente segue tentando no próximo ciclo (best-effort, nunca lança).
 */
export const METRICS_INTERVAL_MS = 60_000;
const FIRST_REPORT_DELAY_MS = 10_000;

export interface CpuSample {
    /** µs de CPU (user + system) consumidos pelo processo desde que nasceu — `process.cpuUsage()`. */
    cpuMicros: number;
    /** relógio monotônico em µs. */
    wallMicros: number;
}

export function sampleProcessCpu(): CpuSample {
    const usage = process.cpuUsage();
    return { cpuMicros: usage.user + usage.system, wallMicros: Number(process.hrtime.bigint() / 1000n) };
}

/**
 * % de CPU do PROCESSO entre duas amostras, normalizado pelo nº de núcleos — 100% = todos os núcleos da máquina
 * ocupados só por este processo (mesma escala que o backend valida, 0-100). 0 se o relógio não avançou.
 */
export function processCpuPercent(previous: CpuSample, current: CpuSample, cores = os.availableParallelism()): number {
    const wallDelta = current.wallMicros - previous.wallMicros;
    if (wallDelta <= 0 || cores <= 0) return 0;
    const percent = ((current.cpuMicros - previous.cpuMicros) / (wallDelta * cores)) * 100;
    return Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10;
}

export interface MachineMetricPayload {
    machineName: string;
    cpuPercent: number;
    rssMb: number;
    heapUsedMb: number;
    processUptimeSec: number;
    machineUptimeSec: number;
    platform: string;
}

export function buildMetricPayload(machineName: string, cpuPercent: number, memory: Pick<NodeJS.MemoryUsage, "rss" | "heapUsed"> = process.memoryUsage()): MachineMetricPayload {
    const toMb = (bytes: number): number => Math.round(bytes / 1024 / 1024);
    return {
        machineName,
        cpuPercent,
        rssMb: toMb(memory.rss),
        heapUsedMb: toMb(memory.heapUsed),
        processUptimeSec: Math.floor(process.uptime()),
        machineUptimeSec: Math.floor(os.uptime()),
        platform: process.platform,
    };
}

async function report(payload: MachineMetricPayload): Promise<void> {
    if (!config.backendUrl || !config.backendApiToken) return;
    try {
        await fetch(`${config.backendUrl}/machine-metrics`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.backendApiToken}` },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        // best-effort — métrica nunca pode virar um segundo problema.
    }
}

export function startMachineMetrics(): void {
    let previous = sampleProcessCpu();
    const tick = (): void => {
        const current = sampleProcessCpu();
        const payload = buildMetricPayload(config.machineName || os.hostname(), processCpuPercent(previous, current));
        previous = current;
        void report(payload);
    };
    setTimeout(tick, FIRST_REPORT_DELAY_MS).unref();
    setInterval(tick, METRICS_INTERVAL_MS).unref();
}
