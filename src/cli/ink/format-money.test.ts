import { test } from "node:test";
import assert from "node:assert/strict";
import { compactTokens, formatCost, formatMoney } from "./format-money.ts";

test("formatCost: 4 casas pra custo de mensagem (senão tudo viraria R$ 0,00/0,06)", () => {
    assert.equal(formatCost(0.0612), "R$ 0,0612");
    assert.equal(formatCost(0.002), "R$ 0,0020");
    assert.equal(formatCost(null), "—");
});

test("formatMoney: 2 casas, milhar com ponto, negativo, e nunca 'R$ 0,00' pra valor positivo pequeno", () => {
    assert.equal(formatMoney(12.345), "R$ 12,35");
    assert.equal(formatMoney(1234.5), "R$ 1.234,50");
    assert.equal(formatMoney(-0.4), "-R$ 0,40");
    assert.equal(formatMoney(0), "R$ 0,00");
    assert.equal(formatMoney(0.004), "R$ 0,0040");
});

test("compactTokens", () => {
    assert.equal(compactTokens(950), "950");
    assert.equal(compactTokens(31_234), "31k");
    assert.equal(compactTokens(1_250_000), "1.3M");
});
