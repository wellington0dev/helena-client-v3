import assert from "node:assert/strict";
import test from "node:test";
import { buildMetricPayload, processCpuPercent, sampleProcessCpu } from "./machine-metrics.ts";

test("processCpuPercent: 1 núcleo inteiro ocupado numa máquina de 4 = 25%", () => {
    assert.equal(processCpuPercent({ cpuMicros: 0, wallMicros: 0 }, { cpuMicros: 1_000_000, wallMicros: 1_000_000 }, 4), 25);
});

test("processCpuPercent: relógio parado devolve 0, sem NaN/Infinity", () => {
    assert.equal(processCpuPercent({ cpuMicros: 0, wallMicros: 10 }, { cpuMicros: 500, wallMicros: 10 }, 4), 0);
});

test("processCpuPercent: sempre entre 0 e 100", () => {
    assert.equal(processCpuPercent({ cpuMicros: 0, wallMicros: 0 }, { cpuMicros: 9_000_000, wallMicros: 1_000_000 }, 2), 100);
    assert.equal(processCpuPercent({ cpuMicros: 500, wallMicros: 0 }, { cpuMicros: 0, wallMicros: 1_000 }, 2), 0);
});

test("sampleProcessCpu: amostra real do processo avança entre duas leituras com trabalho no meio", () => {
    const a = sampleProcessCpu();
    let x = 0;
    for (let i = 0; i < 2_000_000; i++) x += i;
    const b = sampleProcessCpu();
    assert.ok(x > 0 && b.cpuMicros > a.cpuMicros && b.wallMicros > a.wallMicros);
});

test("buildMetricPayload: RSS/heap do processo em MB, uptimes inteiros e plataforma", () => {
    const mb = 1024 * 1024;
    const payload = buildMetricPayload("notebook", 12.5, { rss: 180 * mb, heapUsed: 90 * mb });
    assert.equal(payload.machineName, "notebook");
    assert.equal(payload.cpuPercent, 12.5);
    assert.equal(payload.rssMb, 180);
    assert.equal(payload.heapUsedMb, 90);
    assert.ok(Number.isInteger(payload.processUptimeSec) && payload.processUptimeSec >= 0);
    assert.ok(Number.isInteger(payload.machineUptimeSec) && payload.machineUptimeSec > 0);
    assert.equal(payload.platform, process.platform);
});

test("buildMetricPayload: default lê o process.memoryUsage() real (RSS > 0)", () => {
    assert.ok(buildMetricPayload("x", 0).rssMb > 0);
});
