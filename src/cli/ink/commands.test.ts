import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMANDS, findCommand, formatHelpText, matchCommands } from "./commands.ts";

test("matchCommands: prefixo vazio (\"/\" sozinho) casa com TODOS os comandos, na ordem do registro", () => {
    const result = matchCommands("");
    assert.deepEqual(result.map((c) => c.name), COMMANDS.map((c) => c.name));
});

test("matchCommands: prefixo casa por NOME, case-insensitive", () => {
    assert.deepEqual(matchCommands("con").map((c) => c.name), ["config", "contatos"]);
    assert.deepEqual(matchCommands("CON").map((c) => c.name), ["config", "contatos"]);
});

test("matchCommands: prefixo sem nenhum comando correspondente devolve lista vazia", () => {
    assert.deepEqual(matchCommands("xyz"), []);
});

test("findCommand: resolve só pelo nome — as variações antigas (en/pt-br) não existem mais", () => {
    assert.equal(findCommand("config")?.name, "config");
    assert.equal(findCommand("help")?.name, "help");
    for (const antigo of ["settings", "configuracoes", "ajustes", "sessions", "historico", "limpar", "new", "clear", "permissions", "arvore", "?"]) {
        assert.equal(findCommand(antigo), undefined, `/${antigo} não deveria mais existir`);
    }
    assert.equal(findCommand("inexistente"), undefined);
});

test("um comando por função: nomes únicos e o registro não tem mais campo de apelidos", () => {
    const names = COMMANDS.map((c) => c.name);
    assert.equal(new Set(names).size, names.length);
    for (const command of COMMANDS) assert.ok(!("aliases" in command), `/${command.name} ainda declara aliases`);
});

test("/help lista cada comando uma vez, sem '(ou ...)'", () => {
    const text = formatHelpText();
    assert.ok(!text.includes("(ou "), "o help não pode mais listar variações");
    for (const name of COMMANDS.map((c) => c.name)) assert.equal(text.split(`/${name} `).length - 1, 1, `/${name} deveria aparecer uma vez`);
});
