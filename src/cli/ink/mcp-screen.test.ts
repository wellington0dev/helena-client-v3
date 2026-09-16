import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEnabledField } from "./mcp-screen.ts";

test("resolveEnabledField: 's' e 'n' (case-insensitive, com espaço) sempre respeitados", () => {
    assert.equal(resolveEnabledField("s", false), true);
    assert.equal(resolveEnabledField("S", false), true);
    assert.equal(resolveEnabledField(" s ", false), true);
    assert.equal(resolveEnabledField("n", true), false);
    assert.equal(resolveEnabledField("N", true), false);
});

test("resolveEnabledField: valor inesperado (não 's'/'n') NUNCA vira true por omissão — cai no valor atual", () => {
    // Bug real corrigido: a versão anterior (`!== \"n\"`) tornava isto "true" silenciosamente.
    assert.equal(resolveEnabledField("", false), false);
    assert.equal(resolveEnabledField("não", false), false);
    assert.equal(resolveEnabledField("no", true), true);
    assert.equal(resolveEnabledField("0", false), false);
});

test("resolveEnabledField: sem valor atual (criação) e texto inesperado cai em true (default de criação)", () => {
    assert.equal(resolveEnabledField("", undefined), true);
    assert.equal(resolveEnabledField(undefined, undefined), true);
});
