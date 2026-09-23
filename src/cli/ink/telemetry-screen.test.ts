import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, isStaleMetric, machineLine, telemetryLabel, truncateStack } from "./telemetry-screen.ts";
import type { TelemetryLogEntry } from "../api/telemetry.ts";

const entry = (overrides: Partial<TelemetryLogEntry> = {}): TelemetryLogEntry => ({
    id: "1",
    userId: "u1",
    userEmail: "dono@example.com",
    userDisplayName: null,
    timestamp: "2026-09-23T10:00:00.000Z",
    level: "error",
    message: "Call to 'getMe' failed! (401: Unauthorized)",
    ...overrides,
});

test("telemetryLabel: label começa com o nível entre colchetes, hint traz horário e origem", () => {
    const { label, hint } = telemetryLabel(entry({ source: "client:uncaughtException" }));
    assert.ok(label.includes("[error]"));
    assert.ok(label.includes("Call to 'getMe' failed!"));
    assert.ok(hint.includes("client:uncaughtException"));
});

test("telemetryLabel: só a primeira linha da mensagem entra no label (mensagens multi-linha não estouram a lista)", () => {
    const { label } = telemetryLabel(entry({ message: "primeira linha\nsegunda linha" }));
    assert.ok(label.includes("primeira linha"));
    assert.ok(!label.includes("segunda linha"));
});

test("telemetryLabel: origem ausente vira '?' no hint, nunca 'undefined'", () => {
    const { hint } = telemetryLabel(entry({ source: undefined }));
    assert.ok(hint.includes("?"));
    assert.ok(!hint.includes("undefined"));
});

test("truncateStack: stack curta passa direto, sem cortar nem avisar", () => {
    const stack = "linha 1\nlinha 2";
    assert.equal(truncateStack(stack, 15), stack);
});

test("truncateStack: stack longa corta em maxLines e avisa quantas linhas sobraram", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `linha ${i + 1}`);
    const result = truncateStack(lines.join("\n"), 5);
    assert.equal(result.split("\n").length, 6); // 5 linhas + a de aviso
    assert.ok(result.endsWith("(+15 linhas)"));
    assert.ok(result.startsWith("linha 1\nlinha 2\nlinha 3\nlinha 4\nlinha 5"));
});

test("formatDuration: mostra só as duas maiores unidades", () => {
    assert.equal(formatDuration(45), "45s");
    assert.equal(formatDuration(125), "2m");
    assert.equal(formatDuration(3 * 3600 + 5 * 60), "3h 5m");
    assert.equal(formatDuration(2 * 86400 + 4 * 3600 + 59), "2d 4h");
    assert.equal(formatDuration(-5), "0s");
});

test("isStaleMetric: velho = mais de 2 ciclos do coletor sem reportar", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    assert.equal(isStaleMetric("2026-09-23T11:59:30Z", now), false);
    assert.equal(isStaleMetric("2026-09-23T11:57:00Z", now), true);
});

test("machineLine: CPU, RSS e heap do processo, uptimes do daemon e da máquina", () => {
    const line = machineLine({ id: "1", machineName: "notebook", cpuPercent: 12.5, rssMb: 180, heapUsedMb: 90, processUptimeSec: 3600, machineUptimeSec: 86400, updatedAt: "2026-09-23T12:00:00Z" });
    assert.ok(line.includes("notebook") && line.includes("CPU 12.5%") && line.includes("RAM 180 MB (heap 90 MB)") && line.includes("daemon 1h 0m") && line.includes("máquina 1d 0h"));
});
