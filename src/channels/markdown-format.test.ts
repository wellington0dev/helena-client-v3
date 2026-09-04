import { test } from "node:test";
import assert from "node:assert/strict";
import { toTelegramHtml, toWhatsappText } from "./markdown-format.ts";

test("toTelegramHtml: negrito/itálico/código viram tags HTML", () => {
    const out = toTelegramHtml("**negrito** *itálico* `código`");
    assert.equal(out, "<b>negrito</b> <i>itálico</i> <code>código</code>");
});

test("toTelegramHtml: bloco de código vira <pre>, preservando quebras de linha", () => {
    const out = toTelegramHtml("texto\n\n```text\nlinha 1\nlinha 2\n```");
    assert.match(out, /<pre>linha 1\nlinha 2<\/pre>/);
});

test("toTelegramHtml: escapa <, > e & no texto puro (nunca quebra o parse_mode HTML)", () => {
    const out = toTelegramHtml("1 < 2 & 3 > 0");
    assert.equal(out, "1 &lt; 2 &amp; 3 &gt; 0");
});

test("toTelegramHtml: link markdown vira <a href>", () => {
    const out = toTelegramHtml("[Ver Fatura](https://asaas.com/i/abc)");
    assert.equal(out, '<a href="https://asaas.com/i/abc">Ver Fatura</a>');
});

test("toTelegramHtml: cenário real reportado — negrito + bloco de código + link, sem sintaxe crua sobrando", () => {
    const text = [
        "Agora deu certinho! Aqui está a sua cobrança Pix:",
        "",
        "**Código Copia e Cola:**",
        "```text",
        "00020101021226800014br.gov.bcb.pix",
        "```",
        "",
        "Se preferir, também dá pra acessar a fatura direto pelo link da Asaas: [Ver Fatura](https://www.asaas.com/i/26pog2h4iv3g80vb)"
    ].join("\n");

    const out = toTelegramHtml(text);
    assert.doesNotMatch(out, /\*\*/, "não deveria sobrar ** cru");
    assert.doesNotMatch(out, /\[Ver Fatura\]/, "link não deveria sobrar em sintaxe markdown crua");
    assert.match(out, /<b>Código Copia e Cola:<\/b>/);
    assert.match(out, /<pre>00020101021226800014br\.gov\.bcb\.pix<\/pre>/);
    assert.match(out, /<a href="https:\/\/www\.asaas\.com\/i\/26pog2h4iv3g80vb">Ver Fatura<\/a>/);
});

test("toWhatsappText: negrito vira UM asterisco (não dois)", () => {
    const out = toWhatsappText("**negrito**");
    assert.equal(out, "*negrito*");
});

test("toWhatsappText: itálico (1 asterisco no parser) vira sublinhado; código inline mantém crase", () => {
    const out = toWhatsappText("*itálico* `código`");
    assert.equal(out, "_itálico_ `código`");
});

test("toWhatsappText: bloco de código preserva os delimitadores de crase tripla (suportado nativamente)", () => {
    const out = toWhatsappText("```text\nlinha 1\nlinha 2\n```");
    assert.equal(out, "```linha 1\nlinha 2```");
});

test("toWhatsappText: link markdown vira 'texto: url' (WhatsApp não suporta link com texto customizado)", () => {
    const out = toWhatsappText("[Ver Fatura](https://asaas.com/i/abc)");
    assert.equal(out, "Ver Fatura: https://asaas.com/i/abc");
});
