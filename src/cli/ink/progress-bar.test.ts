import assert from "node:assert/strict";
import test from "node:test";
import { renderBar } from "./progress-bar.ts";

test("renderBar: 0/4 toda vazia, 4/4 toda cheia, largura sempre = width", () => {
    assert.equal(renderBar(0, 4, 8), "░░░░░░░░");
    assert.equal(renderBar(4, 4, 8), "████████");
    assert.equal(renderBar(2, 4, 8), "████░░░░");
});

test("renderBar: total<=0 devolve tudo vazio, sem lançar (nunca NaN/divisão por zero)", () => {
    assert.equal(renderBar(0, 0, 5), "░░░░░");
    assert.equal(renderBar(3, 0, 5), "░░░░░");
    assert.equal(renderBar(0, -1, 5), "░░░░░");
});

test("renderBar: done maior que total nunca estoura a largura", () => {
    assert.equal(renderBar(99, 4, 8), "████████");
});

test("renderBar: width default é 10", () => {
    assert.equal(renderBar(5, 10).length, 10);
});
