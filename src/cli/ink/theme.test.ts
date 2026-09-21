import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bg, panel, PANEL_PADDING_X, PANEL_PADDING_Y, theme } from "./theme.ts";

const dir = path.dirname(fileURLToPath(import.meta.url));
const sources = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "theme.ts")
    .map((f) => ({ file: f, text: fs.readFileSync(path.join(dir, f), "utf8") }));

test("nenhuma tela usa borda (borderStyle) — hierarquia é por cor de fundo, ver theme.ts#panel", () => {
    for (const { file, text } of sources) assert.ok(!text.includes("borderStyle"), `${file} voltou a usar borderStyle`);
});

test("nenhuma tela usa cor crua ('cyan', 'red', chalk.cyan...) nem dimColor — só tokens do tema", () => {
    const raw = /color: "(?:red|green|cyan|yellow|magenta|gray|grey|white|blue|black)"|chalk\.(?:cyan|red|green|yellow|magenta|gray|grey|blue)\b|dimColor/;
    for (const { file, text } of sources) assert.ok(!raw.test(text), `${file} usa cor crua/dimColor em vez de theme.*`);
});

test("panel(): mesma geometria do antigo borderStyle+paddingX:1 (2 colunas de padding, 1 linha) — medições de altura não mudam", () => {
    const p = panel("warning");
    assert.equal(p.paddingX, 2 * 1 /* borda 1 + padding 1 por lado */);
    assert.equal(p.paddingY, 1);
    assert.equal(PANEL_PADDING_X, 2);
    assert.equal(PANEL_PADDING_Y, 1);
    assert.equal(p.backgroundColor, bg.warning);
});

test("paleta: todos os tokens são hex válidos e fundos de mensagem são distintos entre si", () => {
    for (const value of [...Object.values(bg), ...Object.values(theme)]) assert.match(value, /^#[0-9a-f]{6}$/i);
    const distinct = new Set([bg.base, bg.panel, bg.modal, bg.surface, bg.raised, bg.user, bg.helena]);
    assert.equal(distinct.size, 7);
});
