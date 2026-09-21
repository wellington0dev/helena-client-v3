import assert from "node:assert/strict";
import test from "node:test";
import { buildRows, descriptionLines, DESCRIPTION_ROWS, filterItems, hitTest, LIST_OFFSET, MAX_LIST_ROWS, moveSelection, settingsLayout, windowRows, type SettingItem } from "./settings-model.ts";

const item = (id: string, section: string, label: string, description = ""): SettingItem => ({ id, section, label, description, kind: "toggle", value: true });

const items = [item("a", "Interface", "Worktree na lateral"), item("b", "Segurança", "Sempre permitir shell", "roda sem confirmar"), item("c", "Segurança", "Comandos permitidos"), item("d", "Conta", "Tokens de API")];

test("filterItems: sem acento, sem maiúsculas, todas as palavras, em rótulo/descrição/seção", () => {
    assert.equal(filterItems(items, "").length, 4);
    assert.deepEqual(filterItems(items, "SEGURANCA").map((i) => i.id), ["b", "c"]);
    assert.deepEqual(filterItems(items, "permitir shell").map((i) => i.id), ["b"]);
    assert.deepEqual(filterItems(items, "confirmar").map((i) => i.id), ["b"]);
    assert.deepEqual(filterItems(items, "xyz"), []);
});

test("buildRows: um cabeçalho por seção, na ordem, e itemIndex contínuo só entre itens", () => {
    const rows = buildRows(items);
    assert.deepEqual(rows.map((r) => (r.kind === "header" ? `# ${r.section}` : `${r.itemIndex}:${r.item.id}`)), ["# Interface", "0:a", "# Segurança", "1:b", "2:c", "# Conta", "3:d"]);
});

test("windowRows: lista curta mostra tudo; longa mantém o selecionado visível e traz o cabeçalho junto", () => {
    const many = Array.from({ length: 12 }, (_, i) => item(String(i), i < 6 ? "A" : "B", `item ${i}`));
    const rows = buildRows(many); // 14 linhas
    assert.deepEqual(windowRows(buildRows(items), 0, 10), { start: 0, end: 7 });
    for (let selected = 0; selected < many.length; selected++) {
        const { start, end } = windowRows(rows, selected, 6);
        const at = rows.findIndex((r) => r.kind === "item" && r.itemIndex === selected);
        assert.ok(at >= start && at < end, `item ${selected} fora da janela [${start},${end})`);
        assert.equal(end - start, 6);
    }
    // o 1º item da seção B fica logo abaixo do cabeçalho "B" — a janela não pode cortar o cabeçalho
    const w = windowRows(rows, 6, 6);
    assert.ok(rows.slice(w.start, w.end).some((r) => r.kind === "header" && r.section === "B"));
});

test("moveSelection: dá a volta nas pontas; vazio devolve -1", () => {
    assert.equal(moveSelection(4, 3, 1), 0);
    assert.equal(moveSelection(4, 0, -1), 3);
    assert.equal(moveSelection(4, 1, 2), 3);
    assert.equal(moveSelection(0, 0, 1), -1);
});

test("settingsLayout: centralizado, altura = lista + moldura, respeita terminal pequeno", () => {
    const l = settingsLayout(130, 30, 20);
    assert.equal(l.width, 74);
    assert.equal(l.listRows, MAX_LIST_ROWS > 30 - 11 ? 30 - 11 : MAX_LIST_ROWS);
    assert.equal(l.height, l.listRows + 9);
    assert.equal(l.left, Math.floor((130 - 74) / 2));
    assert.equal(l.top, Math.floor((30 - l.height) / 2));
    assert.equal(l.listTop, l.top + LIST_OFFSET);
    const tiny = settingsLayout(40, 12, 20);
    assert.ok(tiny.top >= 0 && tiny.left >= 0 && tiny.listRows >= 3);
    const short = settingsLayout(130, 40, 5);
    assert.equal(short.listRows, 5);
});

test("hitTest: fora do modal, moldura e cada linha da lista (0-based, mesmas coordenadas do layout)", () => {
    const l = settingsLayout(130, 30, 8);
    assert.deepEqual(hitTest(l, 0, 0), { area: "outside" });
    assert.deepEqual(hitTest(l, l.left + l.width, l.top), { area: "outside" });
    assert.deepEqual(hitTest(l, l.left + 10, l.top), { area: "modal" }, "linha de padding do topo");
    assert.deepEqual(hitTest(l, l.left + 10, l.top + 1), { area: "modal" }, "título");
    assert.deepEqual(hitTest(l, l.left + 10, l.listTop), { area: "list", row: 0 });
    assert.deepEqual(hitTest(l, l.left + 10, l.listTop + l.listRows - 1), { area: "list", row: l.listRows - 1 });
    assert.deepEqual(hitTest(l, l.left + 10, l.listTop + l.listRows), { area: "modal" }, "logo abaixo da lista");
    assert.deepEqual(hitTest(l, l.left, l.listTop), { area: "modal" }, "padding lateral não é linha");
});

test("descriptionLines: sempre exatamente 2 linhas; texto longo termina com …", () => {
    assert.equal(descriptionLines("curto", 40).length, DESCRIPTION_ROWS);
    assert.deepEqual(descriptionLines("curto", 40), ["curto", ""]);
    assert.deepEqual(descriptionLines("", 40), ["", ""]);
    const long = descriptionLines("palavra ".repeat(40), 20);
    assert.equal(long.length, DESCRIPTION_ROWS);
    assert.ok(long[1]!.endsWith("…"));
});
