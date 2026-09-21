import assert from "node:assert/strict";
import test from "node:test";
import { commandLabel, formatAge } from "./permissions-screen.ts";

test("commandLabel: comando curto fica igual; comprido é cortado com …; multilinha mostra só a 1ª linha marcada", () => {
    assert.equal(commandLabel("npm test"), "npm test");
    assert.equal(commandLabel("x".repeat(100), 10), "xxxxxxxxx…");
    assert.equal(commandLabel("echo a\necho b"), "echo a …");
    assert.equal(commandLabel("  ls -la  "), "ls -la");
});

test("formatAge: hoje, ontem, dias, meses; data inválida ou no futuro devolve vazio", () => {
    const now = new Date("2026-09-21T12:00:00Z").getTime();
    assert.equal(formatAge("2026-09-21T01:00:00Z", now), "aprovado hoje");
    assert.equal(formatAge("2026-09-20T01:00:00Z", now), "aprovado ontem");
    assert.equal(formatAge("2026-09-11T12:00:00Z", now), "aprovado há 10 dias");
    assert.equal(formatAge("2026-05-01T12:00:00Z", now), "aprovado há 4 meses");
    assert.equal(formatAge("lixo", now), "");
    assert.equal(formatAge("2026-12-01T00:00:00Z", now), "");
});
