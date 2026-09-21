import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, findCommand, matchCommands } from "./commands.ts";

test("matchCommands: prefixo vazio (\"/\" sozinho) casa com TODOS os comandos, na ordem do registro", () => {
    const result = matchCommands("");
    assert.deepEqual(result.map((c) => c.name), COMMANDS.map((c) => c.name));
});

test("matchCommands: prefixo casa por NOME, case-insensitive", () => {
    assert.deepEqual(matchCommands("con").map((c) => c.name), ["config", "contatos"]);
    assert.deepEqual(matchCommands("CON").map((c) => c.name), ["config", "contatos"]);
});

test("matchCommands: prefixo também casa por APELIDO (ex: \"/s\" -> /config via alias \"settings\")", () => {
    const result = matchCommands("set");
    assert.deepEqual(result.map((c) => c.name), ["config"]);
});

test("matchCommands: prefixo sem nenhum comando correspondente devolve lista vazia", () => {
    assert.deepEqual(matchCommands("xyz"), []);
});

test("findCommand: continua resolvendo por nome OU apelido, sem ser afetado pelo novo matchCommands", () => {
    assert.equal(findCommand("config")?.name, "config");
    assert.equal(findCommand("settings")?.name, "config");
    assert.equal(findCommand("?")?.name, "help");
    assert.equal(findCommand("inexistente"), undefined);
});
