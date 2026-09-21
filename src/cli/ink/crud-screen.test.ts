import assert from "node:assert/strict";
import test from "node:test";
import { visibleWindow } from "./crud-screen.ts";

test("visibleWindow: sem teto ou lista curta mostra tudo", () => {
    assert.deepEqual(visibleWindow(5, 2, undefined), { start: 0, end: 5 });
    assert.deepEqual(visibleWindow(5, 4, 5), { start: 0, end: 5 });
    assert.deepEqual(visibleWindow(3, 0, 10), { start: 0, end: 3 });
});

test("visibleWindow: janela acompanha o cursor, centralizada, sem passar das pontas", () => {
    assert.deepEqual(visibleWindow(30, 0, 8), { start: 0, end: 8 });
    assert.deepEqual(visibleWindow(30, 15, 8), { start: 11, end: 19 });
    assert.deepEqual(visibleWindow(30, 29, 8), { start: 22, end: 30 });
    for (let cursor = 0; cursor < 30; cursor++) {
        const { start, end } = visibleWindow(30, cursor, 8);
        assert.ok(cursor >= start && cursor < end, `cursor ${cursor} fora da janela [${start},${end})`);
        assert.equal(end - start, 8);
    }
});
