import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { appendInputHistory, loadInputHistory, MAX_INPUT_HISTORY, newerEntry, NOT_NAVIGATING, olderEntry } from "./input-history.ts";

function tmpFile(): { dir: string; file: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ih-"));
    return { dir, file: path.join(dir, "sub", "input-history.json") };
}

test("navegação: ↑ percorre da mais nova pra mais antiga e para na primeira; ↓ volta e devolve o rascunho", () => {
    const entries = ["a", "b", "c"];
    let r = olderEntry(entries, NOT_NAVIGATING, "rascunho")!;
    assert.equal(r.value, "c");
    r = olderEntry(entries, r.nav, "c")!;
    assert.equal(r.value, "b");
    r = olderEntry(entries, r.nav, "b")!;
    assert.equal(r.value, "a");
    assert.equal(olderEntry(entries, r.nav, "a"), undefined, "não passa da mais antiga");
    let n = newerEntry(entries, r.nav)!;
    assert.equal(n.value, "b");
    n = newerEntry(entries, n.nav)!;
    assert.equal(n.value, "c");
    n = newerEntry(entries, n.nav)!;
    assert.equal(n.value, "rascunho");
    assert.equal(n.nav.index, null);
    assert.equal(newerEntry(entries, n.nav), undefined, "↓ fora do histórico não faz nada");
});

test("navegação: lista vazia não faz nada", () => {
    assert.equal(olderEntry([], NOT_NAVIGATING, "x"), undefined);
});

test("appendInputHistory: grava com 0600, não repete a última, ignora vazio e respeita o teto", () => {
    const { dir, file } = tmpFile();
    try {
        let entries: string[] = [];
        entries = appendInputHistory(entries, "  oi  ", file);
        entries = appendInputHistory(entries, "oi", file);
        entries = appendInputHistory(entries, "   ", file);
        assert.deepEqual(entries, ["oi"]);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.deepEqual(loadInputHistory(file), ["oi"]);
        for (let i = 0; i < MAX_INPUT_HISTORY + 20; i++) entries = appendInputHistory(entries, `msg ${i}`, file);
        assert.equal(entries.length, MAX_INPUT_HISTORY);
        assert.equal(entries[entries.length - 1], `msg ${MAX_INPUT_HISTORY + 19}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("loadInputHistory: arquivo ausente, corrompido ou com lixo devolve só o que é texto válido", () => {
    const { dir, file } = tmpFile();
    try {
        assert.deepEqual(loadInputHistory(file), []);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, "não é json");
        assert.deepEqual(loadInputHistory(file), []);
        fs.writeFileSync(file, JSON.stringify(["ok", 5, null, "  ", "outra"]));
        assert.deepEqual(loadInputHistory(file), ["ok", "outra"]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
