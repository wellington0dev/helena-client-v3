import assert from "node:assert/strict";
import test from "node:test";
import { applyKey, type TextInputState } from "./text-input.ts";

const at = (value: string, cursorOffset = value.length): TextInputState => ({ value, cursorOffset, cursorWidth: 0 });

test("applyKey: Ctrl+P (paleta) não vaza o 'p' pro campo", () => {
    assert.equal(applyKey(at("oi"), "p", { ctrl: true }), "ignore");
});

test("applyKey: nenhum Ctrl+letra nem Alt+letra vira texto", () => {
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
        assert.equal(applyKey(at(""), letter, { ctrl: true }), "ignore", `Ctrl+${letter}`);
        assert.equal(applyKey(at(""), letter, { meta: true }), "ignore", `Alt+${letter}`);
    }
});

test("applyKey: digitar comum insere na posição do cursor", () => {
    assert.deepEqual(applyKey(at("ac", 1), "b", {}), { value: "abc", cursorOffset: 2, cursorWidth: 0 });
});

test("applyKey: colagem (várias letras de uma vez) insere tudo e marca a largura", () => {
    assert.deepEqual(applyKey(at(""), "colado", {}), { value: "colado", cursorOffset: 6, cursorWidth: 6 });
});

test("applyKey: backspace continua funcionando mesmo se o terminal marcar ctrl/meta junto", () => {
    assert.deepEqual(applyKey(at("abc"), "", { backspace: true, meta: true }), { value: "ab", cursorOffset: 2, cursorWidth: 0 });
    assert.deepEqual(applyKey(at("abc"), "", { delete: true, ctrl: true }), { value: "ab", cursorOffset: 2, cursorWidth: 0 });
});

test("applyKey: setas laterais movem o cursor sem sair dos limites", () => {
    assert.equal((applyKey(at("ab", 0), "", { leftArrow: true }) as TextInputState).cursorOffset, 0);
    assert.equal((applyKey(at("ab", 2), "", { rightArrow: true }) as TextInputState).cursorOffset, 2);
    assert.equal((applyKey(at("ab", 1), "", { leftArrow: true }) as TextInputState).cursorOffset, 0);
});

test("applyKey: Enter submete; cima/baixo/Tab ficam pro menu de comandos", () => {
    assert.equal(applyKey(at("x"), "", { return: true }), "submit");
    for (const key of [{ upArrow: true }, { downArrow: true }, { tab: true }]) assert.equal(applyKey(at("x"), "", key), "ignore");
});
