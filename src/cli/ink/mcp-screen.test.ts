import { test } from "node:test";
import assert from "node:assert/strict";
import { isLocalServerUrl, resolveEnabledField, resolveMachineField } from "./mcp-screen.ts";

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

test("isLocalServerUrl: localhost, loopback e faixas privadas são locais; público e URL inválida não", () => {
    for (const u of ["http://localhost:3002", "http://127.0.0.1:8080/mcp", "http://[::1]:3000", "http://10.0.0.5", "http://172.20.1.1", "http://192.168.0.10:3000", "http://nas.local/mcp", "http://[fd12:3456::1]/mcp"]) {
        assert.equal(isLocalServerUrl(u), true, u);
    }
    for (const u of ["https://mcp.example.com/mcp", "http://172.32.0.1", "http://8.8.8.8", "localhost:3002", "lixo"]) {
        assert.equal(isLocalServerUrl(u), false, u);
    }
});

test("resolveMachineField: em branco + URL local vira ESTA máquina (bug real: localhost:3002 recusado pelo guard de SSRF)", () => {
    assert.equal(resolveMachineField("", "http://localhost:3002", "veronica"), "veronica");
    assert.equal(resolveMachineField(undefined, "http://127.0.0.1:3002", "veronica"), "veronica");
});

test("resolveMachineField: nome digitado sempre vence; URL pública em branco continua direto (undefined)", () => {
    assert.equal(resolveMachineField(" outra ", "http://localhost:3002", "veronica"), "outra");
    assert.equal(resolveMachineField("", "https://mcp.example.com/mcp", "veronica"), undefined);
});
