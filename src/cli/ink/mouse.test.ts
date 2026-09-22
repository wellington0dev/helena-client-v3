import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeMouse, MOUSE_OFF, MOUSE_ON, parseMouse, stripMouse } from "./mouse.ts";

test("parseMouse: clique esquerdo (press/release) converte de 1-based pra 0-based", () => {
    const { events, rest } = parseMouse("[<0;10;5M[<0;10;5m");
    assert.equal(rest, "");
    assert.deepEqual(events.map((e) => [e.type, e.button, e.x, e.y]), [["press", "left", 9, 4], ["release", "left", 9, 4]]);
});

test("parseMouse: aceita com ESC na frente e botões do meio/direito", () => {
    const { events } = parseMouse("\x1b[<1;1;1M\x1b[<2;3;4M");
    assert.deepEqual(events.map((e) => [e.button, e.x, e.y]), [["middle", 0, 0], ["right", 2, 3]]);
});

test("parseMouse: roda do mouse (64 = pra cima, 65 = pra baixo)", () => {
    const { events } = parseMouse("[<64;10;5M[<65;10;5M");
    assert.deepEqual(events.map((e) => e.type), ["wheelUp", "wheelDown"]);
});

test("parseMouse: movimento sem botão (35) vira 'move'; arrastar com botão (32) também é move", () => {
    const { events } = parseMouse("[<35;11;6M[<32;12;7M");
    assert.deepEqual(events.map((e) => [e.type, e.button, e.x, e.y]), [["move", "none", 10, 5], ["move", "left", 11, 6]]);
});

test("parseMouse: modificadores shift/alt/ctrl", () => {
    const [e] = parseMouse("[<28;1;1M").events; // 0 + 4 shift + 8 alt + 16 ctrl
    assert.deepEqual([e!.shift, e!.alt, e!.ctrl], [true, true, true]);
});

test("parseMouse: rajada junta vários eventos; texto que não é mouse sobra em `rest`", () => {
    const { events, rest } = parseMouse("a[<0;2;2Mb[<0;2;2mc");
    assert.equal(events.length, 2);
    assert.equal(rest, "abc");
});

test("parseMouse/looksLikeMouse: teclado comum não é mouse", () => {
    assert.deepEqual(parseMouse("hello"), { events: [], rest: "hello" });
    assert.equal(looksLikeMouse("[A"), false);
    assert.equal(looksLikeMouse("[<0;10;5M"), true);
    assert.equal(looksLikeMouse("[<0;10;5M"), true, "regex global não pode guardar estado entre chamadas");
});

test("MOUSE_ON/OFF: ligar usa 1003+1006; desligar cobre todos os modos (nunca deixa o terminal em modo mouse)", () => {
    assert.match(MOUSE_ON, /1003h/);
    assert.match(MOUSE_ON, /1006h/);
    for (const mode of ["1003l", "1002l", "1000l", "1006l"]) assert.ok(MOUSE_OFF.includes(mode), `falta ${mode}`);
});

test("stripMouse: tira sequências de mouse do texto digitado e preserva o resto (inclusive colchetes e < legítimos)", () => {
    assert.equal(stripMouse("8683914328[<0;20;12m"), "8683914328");
    assert.equal(stripMouse("a[<0;1;1Mb[<0;1;1mc"), "abc");
    assert.equal(stripMouse("x\x1b[<35;2;3My"), "xy");
    assert.equal(stripMouse("array[<T>] e a[0]"), "array[<T>] e a[0]");
    assert.equal(stripMouse(""), "");
});
