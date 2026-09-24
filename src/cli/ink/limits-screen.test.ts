import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIntInRange, rateExplanation } from "./limits-screen.ts";

const base = { usdBrlRate: 5.1856, source: "awesomeapi", refreshIntervalMinutes: 60, markup: 1.1 };

test("rateExplanation: cotação, fonte com 'há X min', fórmula com a margem e exemplo real", () => {
    const now = new Date("2026-09-24T18:00:00Z");
    const lines = rateExplanation({ ...base, updatedAt: "2026-09-24T17:48:00Z", example: { source: "history", costBrl: 0.0696, messages: 42 } }, now);
    assert.match(lines[0]!, /R\$ 5,1856 \(AwesomeAPI, atualizada há 12 min\)/);
    assert.match(lines[1]!, /× cotação × 1,1 \(margem de 10%\)/);
    assert.match(lines[2]!, /a cada 60 min; se a API falhar, vale a última cotação boa/);
    assert.match(lines[3]!, /em média R\$ 0,0696 \(últimos 30 dias, 42 mensagens\)/);
});

test("rateExplanation: sem API ainda (valor fixo) e sem histórico (estimativa)", () => {
    const lines = rateExplanation({ ...base, source: "padrão 5,5", usdBrlRate: 5.5, updatedAt: null, example: { source: "synthetic", costBrl: 0.05 } });
    assert.match(lines[0]!, /valor fixo \(padrão 5,5\) — nenhuma API respondeu ainda/);
    assert.match(lines[3]!, /estimativa — ainda sem histórico teu/);
});

test("parseIntInRange: só inteiro dentro da faixa", () => {
    const b = { min: 1, max: 60 };
    assert.equal(parseIntInRange("10", b), 10);
    assert.equal(parseIntInRange(" 60 ", b), 60);
    for (const bad of ["0", "61", "2.5", "", "dez", "-1"]) assert.equal(parseIntInRange(bad, b), undefined, bad);
});
