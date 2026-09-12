import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUsageLine } from "./format-usage.ts";

test("formatUsageLine: tokens pequenos mostram o número exato, duração em ms abaixo de 1s", () => {
    assert.equal(formatUsageLine({ inputTokens: 120, outputTokens: 45, durationMs: 340 }), "↑120 ↓45 tokens · 340ms");
});

test("formatUsageLine: tokens na casa dos milhares abreviam com 1 casa decimal", () => {
    assert.equal(formatUsageLine({ inputTokens: 1234, outputTokens: 5678, durationMs: 900 }), "↑1.2k ↓5.7k tokens · 900ms");
});

test("formatUsageLine: milhão de tokens abrevia com M", () => {
    assert.equal(formatUsageLine({ inputTokens: 2_500_000, durationMs: 500 }), "↑2.5M tokens · 500ms");
});

test("formatUsageLine: duração de 1s ou mais mostra em segundos com 1 casa decimal", () => {
    assert.equal(formatUsageLine({ inputTokens: 10, outputTokens: 10, durationMs: 3450 }), "↑10 ↓10 tokens · 3.5s");
});

test("formatUsageLine: sem tokens nenhum (undefined), mostra só a duração", () => {
    assert.equal(formatUsageLine({ durationMs: 200 }), "200ms");
});

test("formatUsageLine: só inputTokens (sem outputTokens), mostra só a seta de entrada", () => {
    assert.equal(formatUsageLine({ inputTokens: 50, durationMs: 100 }), "↑50 tokens · 100ms");
});
