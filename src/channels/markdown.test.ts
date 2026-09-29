import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseBlocks } from "./markdown.ts";

test("parseInline: negrito, itálico e código inline", () => {
    const nodes = parseInline("normal **negrito** *itálico* `código`");
    assert.deepEqual(nodes.map((n) => n.kind), ["text", "bold", "text", "italic", "text", "code"]);
});

test("parseInline: link/imagem markdown", () => {
    const nodes = parseInline("veja ![alt](http://x/img.png)");
    assert.deepEqual(nodes[1], { kind: "image", alt: "alt", url: "http://x/img.png" });
});

test("parseBlocks: bloco de código (crase tripla) vira 'codeblock', texto cru sem processar inline", () => {
    const text = "antes\n```text\nlinha *não* deve virar itálico\noutra linha\n```\ndepois";
    const blocks = parseBlocks(text);

    const codeblock = blocks.find((b) => b.kind === "codeblock");
    assert.ok(codeblock, "deveria ter um bloco de código");
    assert.equal(codeblock!.text, "linha *não* deve virar itálico\noutra linha");
});

test("parseBlocks: bloco de código sem linguagem declarada (``` sozinho)", () => {
    const blocks = parseBlocks("```\nconteudo\n```");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, "codeblock");
    assert.equal((blocks[0] as { text: string }).text, "conteudo");
});

test("parseBlocks: bloco de código nunca fechado não trava (pega até o fim)", () => {
    const blocks = parseBlocks("```\nsem fechamento");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, "codeblock");
});

test("parseBlocks: heading, hr, lista ordenada/não-ordenada e parágrafo", () => {
    const blocks = parseBlocks("# Título\n\n---\n\n- item um\n- item dois\n\n1. primeiro\n\nparágrafo normal");
    assert.deepEqual(blocks.map((b) => b.kind), ["heading", "hr", "list", "list", "paragraph"]);
});

// --- Blocos interativos (docs/formato-interativo-chat.md, raiz do monorepo) ---

test("parseBlocks: <select> com value explícito e implícito", () => {
    const blocks = parseBlocks('<select label="Qual prato você quer?">\n<option>Pizza</option>\n<option value="sushi-completo">Sushi (combo completo)</option>\n</select>');
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], {
        kind: "select",
        label: "Qual prato você quer?",
        multiple: false,
        options: [
            { text: "Pizza", value: "Pizza" },
            { text: "Sushi (combo completo)", value: "sushi-completo" },
        ],
    });
});

test("parseBlocks: <select multiple=\"true\">", () => {
    const blocks = parseBlocks('<select label="Escolha os sabores" multiple="true">\n<option>Morango</option>\n<option>Chocolate</option>\n</select>');
    assert.equal(blocks[0]!.kind, "select");
    assert.equal((blocks[0] as { multiple: boolean }).multiple, true);
});

test("parseBlocks: <box> com título, conteúdo markdown normal recursivo", () => {
    const blocks = parseBlocks('<box title="Resumo do pedido">\nPode ter **negrito** aqui dentro.\n</box>');
    assert.equal(blocks.length, 1);
    const box = blocks[0]!;
    assert.equal(box.kind, "box");
    assert.equal((box as { title?: string }).title, "Resumo do pedido");
    const content = (box as { content: ReturnType<typeof parseBlocks> }).content;
    assert.equal(content.length, 1);
    assert.equal(content[0]!.kind, "paragraph");
});

test("parseBlocks: <box> pode conter <select> aninhado", () => {
    const blocks = parseBlocks('<box title="Escolha">\n<select label="Prefere qual?">\n<option>A</option>\n</select>\n</box>');
    const box = blocks[0]! as { kind: "box"; content: ReturnType<typeof parseBlocks> };
    assert.equal(box.content[0]!.kind, "select");
});

test("parseBlocks: <form> com input/select/button, na ordem em que aparecem", () => {
    const text = [
        '<form label="Cadastro rápido">',
        '<input name="nome" label="Seu nome" type="text" />',
        '<input name="idade" label="Idade" type="number" />',
        '<select label="Prefere contato por" multiple="false">',
        "<option>WhatsApp</option>",
        "<option>Email</option>",
        "</select>",
        "<button>Enviar</button>",
        "</form>",
    ].join("\n");
    const blocks = parseBlocks(text);
    assert.equal(blocks.length, 1);
    const form = blocks[0]! as { kind: "form"; label?: string; items: Array<{ kind: string }> };
    assert.equal(form.label, "Cadastro rápido");
    assert.deepEqual(
        form.items.map((i) => i.kind),
        ["input", "input", "select", "button"],
    );
});

test("parseBlocks: <button> avulso vira bloco 'button'", () => {
    const blocks = parseBlocks("<button>Pode cancelar a viagem</button>");
    assert.deepEqual(blocks, [{ kind: "button", text: "Pode cancelar a viagem" }]);
});

test("parseBlocks: <select> sem fechamento cai pra texto literal (nunca lança)", () => {
    const blocks = parseBlocks('<select label="Sem fechamento">\n<option>A</option>\nresto do texto');
    assert.ok(blocks.every((b) => b.kind !== "select"));
});

test("parseBlocks: <select> sem label (atributo obrigatório) cai pra texto literal", () => {
    const blocks = parseBlocks("<select>\n<option>A</option>\n</select>");
    assert.ok(blocks.every((b) => b.kind !== "select"));
});

test("parseBlocks: <form> sem nenhum <button> cai pra texto literal (nada pra submeter)", () => {
    const blocks = parseBlocks('<form label="Sem botão">\n<input name="x" label="X" />\n</form>');
    assert.ok(blocks.every((b) => b.kind !== "form"));
});

test("parseBlocks: <select> com aspas simples (fora do padrão) cai pra texto literal", () => {
    const blocks = parseBlocks("<select label='Sem aspas duplas'>\n<option>A</option>\n</select>");
    assert.ok(blocks.every((b) => b.kind !== "select"));
});

test("parseBlocks: tag interativa dentro de code fence nunca é interpretada", () => {
    const blocks = parseBlocks('```\n<select label="Isso é só exemplo">\n<option>A</option>\n</select>\n```');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0]!.kind, "codeblock");
});
