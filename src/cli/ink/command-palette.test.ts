import assert from "node:assert/strict";
import test from "node:test";
import { COMMANDS } from "./commands.ts";
import { buildPaletteItems } from "./command-palette.ts";

test("buildPaletteItems: uma linha por comando, sem perder nem duplicar nenhum", () => {
    const items = buildPaletteItems();
    assert.equal(items.length, COMMANDS.length);
    assert.deepEqual(new Set(items.map((i) => i.id)), new Set(COMMANDS.map((c) => c.name)));
});

test("buildPaletteItems: seções agrupadas em blocos contíguos, mesmo com COMMANDS intercalando seções", () => {
    // COMMANDS (ver commands.ts) intercala "Conta"/"Integrações" de propósito — a ordem ali é a do "/" no composor,
    // travada por commands.test.ts, então NÃO reflete agrupamento por seção. Se buildPaletteItems reagrupasse mal,
    // uma mesma seção reapareceria depois de outra (cabeçalho duplicado no modal).
    const sections = buildPaletteItems().map((i) => i.section);
    const collapsed = sections.filter((s, i) => s !== sections[i - 1]);
    assert.equal(new Set(collapsed).size, collapsed.length, "uma seção reaparece depois de outra — o cabeçalho duplicaria");
});

test("buildPaletteItems: label é sempre '/nome', description bate com o comando original", () => {
    for (const item of buildPaletteItems()) {
        assert.equal(item.label, `/${item.command.name}`);
        assert.equal(item.description, item.command.description);
        assert.equal(item.section, item.command.section);
    }
});
