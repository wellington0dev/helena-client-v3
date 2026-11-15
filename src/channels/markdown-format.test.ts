import { test } from "node:test";
import assert from "node:assert/strict";
import { toTelegramContent, toTelegramHtml, toWhatsappText } from "./markdown-format.ts";

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

// --- Degradação de blocos interativos (docs/formato-interativo-chat.md §6) — rede de segurança: o modelo
// nunca deveria emitir essas tags fora do painel/CLI, mas se acontecer, WhatsApp/Telegram não podem mostrar
// um <select>/<form> cru, então vira texto numerado simples. ---

const SELECT = '<select label="Qual prato você quer?">\n<option>Pizza</option>\n<option>Sushi</option>\n</select>';
const FORM = '<form label="Cadastro">\n<input name="nome" label="Seu nome" />\n<button>Enviar</button>\n</form>';

test("toTelegramHtml: <select> degrada pra lista numerada com instrução", () => {
    const out = toTelegramHtml(SELECT);
    assert.match(out, /Qual prato você quer\?/);
    assert.match(out, /1\. Pizza/);
    assert.match(out, /2\. Sushi/);
    assert.match(out, /responda com o número ou o texto da opção/);
});

test("toWhatsappText: <select> degrada pra lista numerada (mesmo texto, sem HTML)", () => {
    const out = toWhatsappText(SELECT);
    assert.doesNotMatch(out, /<select|<option/);
    assert.match(out, /1\. Pizza/);
});

test("toTelegramHtml: <form> degrada pra perguntas numeradas + instrução de resposta única", () => {
    const out = toTelegramHtml(FORM);
    assert.match(out, /Cadastro/);
    assert.match(out, /1\. Seu nome/);
    assert.doesNotMatch(out, /Enviar/); // botão não vira "pergunta" numerada
    assert.match(out, /campo: valor/);
});

test("toWhatsappText: <box> degrada pro título em negrito (1 asterisco) + conteúdo, sem borda desenhada", () => {
    const out = toWhatsappText('<box title="Resumo">\nConteúdo aqui.\n</box>');
    assert.match(out, /\*Resumo\*/);
    assert.match(out, /Conteúdo aqui\./);
});

test("toTelegramHtml: <button> avulso degrada pro próprio texto, sem numeração", () => {
    const out = toTelegramHtml("<button>Pode cancelar a viagem</button>");
    assert.equal(out, "Pode cancelar a viagem");
});

// --- toTelegramContent (Fase 2): mesmos blocos, mas virando inline keyboard nativo em vez de degradar.
// O `answer` de cada botão é EXATAMENTE o texto que o clique manda pro backend (protocolo do painel web,
// ver markdown-blocks.ts) — é o que garante que o agente recebe uma mensagem normal, sem contrato novo. ---

test("toTelegramContent: texto sem interação não gera teclado e rende igual ao toTelegramHtml", () => {
    const text = "Oi! **tudo bem?**";
    const content = toTelegramContent(text);

    assert.deepEqual(content.rows, []);
    assert.equal(content.html, toTelegramHtml(text));
});

test("toTelegramContent: <select> de escolha única vira uma linha de botões, cada um mandando 'label: opção'", () => {
    const content = toTelegramContent(SELECT);

    assert.equal(content.rows.length, 1);
    assert.deepEqual(content.rows[0], [
        { text: "Pizza", answer: "Qual prato você quer?: Pizza" },
        { text: "Sushi", answer: "Qual prato você quer?: Sushi" },
    ]);
    assert.match(content.html, /Qual prato você quer\?/);
    // as opções NÃO aparecem como texto numerado — só como botão
    assert.doesNotMatch(content.html, /1\. Pizza/);
});

test("toTelegramContent: <select multiple> degrada pra texto numerado, sem teclado (precisa marcar N + confirmar)", () => {
    const content = toTelegramContent('<select label="Sabores" multiple="true">\n<option>Morango</option>\n<option>Chocolate</option>\n</select>');

    assert.deepEqual(content.rows, []);
    assert.match(content.html, /1\. Morango/);
    assert.match(content.html, /responda com o número ou o texto da opção/);
});

test("toTelegramContent: <button> avulso vira botão que manda o próprio texto; o texto da mensagem cai pro rótulo do botão", () => {
    const content = toTelegramContent("<button>Pode cancelar a viagem</button>");

    assert.deepEqual(content.rows, [[{ text: "Pode cancelar a viagem", answer: "Pode cancelar a viagem" }]]);
    assert.equal(content.html, "Pode cancelar a viagem"); // nunca vazio — Telegram recusa mensagem sem texto
});

test("toTelegramContent: <form> com campo degrada tudo pra texto (botão não coleta valor de input)", () => {
    const content = toTelegramContent(FORM);

    assert.deepEqual(content.rows, []);
    assert.match(content.html, /1\. Seu nome/);
    assert.match(content.html, /campo: valor/);
    assert.doesNotMatch(content.html, /Enviar/);
});

test("toTelegramContent: <form> só de botões vira uma linha de botões (cada um manda o próprio texto)", () => {
    const content = toTelegramContent('<form label="Confirma?">\n<button>Sim</button>\n<button>Não</button>\n</form>');

    assert.deepEqual(content.rows, [
        [
            { text: "Sim", answer: "Sim" },
            { text: "Não", answer: "Não" },
        ],
    ]);
    assert.match(content.html, /Confirma\?/);
});

test("toTelegramContent: <box> com <select> dentro gera o botão mesmo aninhado", () => {
    const content = toTelegramContent('<box title="Escolha">\n<select label="Prefere?">\n<option>A</option>\n</select>\n</box>');

    assert.deepEqual(content.rows, [[{ text: "A", answer: "Prefere?: A" }]]);
    assert.match(content.html, /Escolha/);
    assert.match(content.html, /Prefere\?/);
});
