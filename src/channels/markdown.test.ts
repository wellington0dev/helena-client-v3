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
