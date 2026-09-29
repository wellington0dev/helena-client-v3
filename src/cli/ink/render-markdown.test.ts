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

// --- Blocos interativos — modo ESTÁTICO (streaming/histórico, ver docs/formato-interativo-chat.md §3/§4).
// A versão clicável de verdade é um componente Ink separado, fora deste renderer. ---

test("renderMarkdownAnsi: <select> vira lista numerada com a pergunta e instrução", () => {
    const out = renderMarkdownAnsi('<select label="Qual prato você quer?">\n<option>Pizza</option>\n<option>Sushi</option>\n</select>');
    assert.match(out, /Qual prato você quer\?/);
    assert.match(out, /1\. Pizza/);
    assert.match(out, /2\. Sushi/);
    assert.match(out, /responda com o número ou o texto da opção/);
});

test("renderMarkdownAnsi: <box> mostra título e indenta o conteúdo", () => {
    const out = renderMarkdownAnsi('<box title="Resumo">\nConteúdo aqui.\n</box>');
    assert.match(out, /Resumo/);
    assert.match(out, /Conteúdo aqui\./);
});

test("renderMarkdownAnsi: <form> lista os labels dos campos sem valor (somente leitura)", () => {
    const out = renderMarkdownAnsi('<form label="Cadastro">\n<input name="nome" label="Seu nome" />\n<button>Enviar</button>\n</form>');
    assert.match(out, /Cadastro/);
    assert.match(out, /Seu nome:/);
});

test("renderMarkdownAnsi: <button> avulso mostra o próprio texto", () => {
    const out = renderMarkdownAnsi("<button>Pode cancelar a viagem</button>");
    assert.match(out, /Pode cancelar a viagem/);
});

test("renderMarkdownAnsi: tag malformada nunca lança, vira texto literal", () => {
    assert.doesNotThrow(() => renderMarkdownAnsi('<select label="sem fechamento">\n<option>A</option>'));
});
