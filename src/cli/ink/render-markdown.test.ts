import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdownAnsi } from "./render-markdown.ts";

test("renderMarkdownAnsi: negrito/código preservam o texto (a formatação ANSI em si é responsabilidade do chalk — sem TTY neste teste ele não emite os códigos, só o conteúdo)", () => {
    const out = renderMarkdownAnsi("**negrito** `codigo`");
    assert.match(out, /negrito/);
    assert.match(out, /codigo/);
});

test("renderMarkdownAnsi: texto sem formatação nenhuma passa direto", () => {
    const out = renderMarkdownAnsi("texto simples");
    assert.equal(out, "texto simples");
});

test("renderMarkdownAnsi: lista ordenada numera, não-ordenada usa marcador", () => {
    assert.equal(renderMarkdownAnsi("1. um\n2. dois"), "1. um\n2. dois");
    assert.equal(renderMarkdownAnsi("- um\n- dois"), "• um\n• dois");
});

test("renderMarkdownAnsi: link mostra texto e url", () => {
    const out = renderMarkdownAnsi("[Ver fatura](https://asaas.com/i/abc)");
    assert.match(out, /Ver fatura/);
    assert.match(out, /https:\/\/asaas\.com\/i\/abc/);
});
