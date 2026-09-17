import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUsageView } from "./usage-view.ts";
import type { UsageSummary } from "../api/usage.ts";

const TODAY = new Date("2026-09-17T12:00:00");

test("buildUsageView: ordem/rótulos fixos dos 4 canais, mesmo com callsByChannel parcial", () => {
    const usage: UsageSummary = { totalCalls: 5, callsByChannel: { whatsapp: 5 }, callsByDay: [] };
    const view = buildUsageView(usage, TODAY);

    assert.deepEqual(
        view.channelTiles.map((t) => t.key),
        ["panel", "whatsapp", "telegram", "cli"],
    );
    assert.deepEqual(
        view.channelTiles.map((t) => t.label),
        ["Chat", "WhatsApp", "Telegram", "API"],
    );
    assert.deepEqual(
        view.channelTiles.map((t) => t.value),
        [0, 5, 0, 0],
    );
});

test("buildUsageView: 7 dias sempre presentes, dias sem chamada viram 0 (API só devolve dias com atividade)", () => {
    const usage: UsageSummary = { totalCalls: 3, callsByChannel: {}, callsByDay: [{ date: "2026-09-17", calls: 3 }] };
    const view = buildUsageView(usage, TODAY);

    assert.equal(view.weekBars.length, 7);
    assert.equal(view.weekBars[6]?.date, "2026-09-17");
    assert.equal(view.weekBars[6]?.calls, 3);
    assert.equal(view.weekBars[0]?.calls, 0); // 6 dias atras, sem entrada na API
});

test("buildUsageView: piso de 3% quando todos os valores da semana são 0", () => {
    const usage: UsageSummary = { totalCalls: 0, callsByChannel: {}, callsByDay: [] };
    const view = buildUsageView(usage, TODAY);

    for (const bar of view.weekBars) assert.equal(bar.heightPct, 3);
});

test("buildUsageView: dia com mais chamadas fica em 100%, resto proporcional", () => {
    const usage: UsageSummary = {
        totalCalls: 15,
        callsByChannel: {},
        callsByDay: [
            { date: "2026-09-16", calls: 5 },
            { date: "2026-09-17", calls: 10 },
        ],
    };
    const view = buildUsageView(usage, TODAY);

    const day16 = view.weekBars.find((b) => b.date === "2026-09-16");
    const day17 = view.weekBars.find((b) => b.date === "2026-09-17");
    assert.equal(day17?.heightPct, 100);
    assert.equal(day16?.heightPct, 50);
});

test("buildUsageView: rótulo de dia da semana em pt-BR bate com o Date real (horário local, sem deslocar)", () => {
    // 2026-09-17 é uma quinta-feira.
    const usage: UsageSummary = { totalCalls: 0, callsByChannel: {}, callsByDay: [] };
    const view = buildUsageView(usage, TODAY);
    assert.equal(view.weekBars[6]?.label, "qui");
});
