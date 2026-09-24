import { test } from "node:test";
import assert from "node:assert/strict";
import { countWrappedLines, fitLines, measureDraftBubble, pageDown, pageUp } from "./viewport.ts";

const shown = (r: ReturnType<typeof fitLines>) => r.items.map((i) => [i.index, i.clipTop, i.rows]);

test("fitLines: tudo cabe -> mostra tudo inteiro, sem scroll", () => {
    const r = fitLines([1, 1, 1], 10, null);
    assert.deepEqual(shown(r), [[0, 0, 1], [1, 0, 1], [2, 0, 1]]);
    assert.equal(r.canScrollUp, false);
    assert.equal(r.canScrollDown, false);
});

test("fitLines: BUG da tela vazia — resposta mais alta que a tela aparece (cortada em cima), nunca some", () => {
    // Antes: [3, 40] com 20 linhas -> janela vazia (o item de 40 nunca cabia inteiro) + só "PageUp".
    const r = fitLines([3, 40], 20, null);
    assert.deepEqual(shown(r), [[1, 20, 20]]);
    assert.equal(r.canScrollUp, true);
});

test("fitLines: PageUp anda por LINHAS dentro da resposta longa até o começo dela e depois pros itens de cima", () => {
    const heights = [3, 40];
    let r = fitLines(heights, 20, null);
    r = fitLines(heights, 20, pageUp(r, 20)); // bottom 43 -> 24: janela [4,24) = só a resposta longa, 1 linha escondida em cima
    assert.deepEqual(shown(r), [[1, 1, 20]]);
    r = fitLines(heights, 20, pageUp(r, 20)); // no topo: não passa de 20 (tela cheia)
    assert.deepEqual(shown(r), [[0, 0, 3], [1, 0, 17]]);
    assert.equal(r.canScrollUp, false);
    assert.equal(r.canScrollDown, true);
});

test("fitLines: PageDown volta a grudar no fim (null) quando chega lá", () => {
    const heights = [3, 40];
    const r = fitLines(heights, 20, 20);
    const next = pageDown(r, 20);
    assert.equal(next, 39);
    assert.equal(pageDown(fitLines(heights, 20, next), 20), null);
});

test("fitLines: corta o item de cima pela metade quando a janela começa no meio dele", () => {
    const r = fitLines([3, 2, 4, 1], 6, null);
    // total 10, janela [4,10): item0 fora, item1 (linhas 3-4) perde 1 em cima, item2 inteiro, item3 inteiro
    assert.deepEqual(shown(r), [[1, 1, 1], [2, 0, 4], [3, 0, 1]]);
});

test("fitLines: `bottom` é linha ABSOLUTA — mensagem nova chegando por baixo não mexe no que está sendo lido", () => {
    const before = fitLines([5, 5], 4, 6);
    const after = fitLines([5, 5, 5, 5], 4, 6);
    assert.deepEqual(shown(before), shown(after));
    assert.equal(after.canScrollDown, true);
});

test("fitLines: `bottom` fora da faixa é clampado; lista vazia e tela zerada nunca lançam", () => {
    assert.equal(fitLines([1, 1], 10, 999).bottom, 2);
    assert.equal(fitLines([5, 5], 4, -3).bottom, 4);
    assert.deepEqual(shown(fitLines([], 10, null)), []);
    assert.deepEqual(shown(fitLines([1, 1, 1], 0, null)), []);
});

test("countWrappedLines: texto vazio conta como 1 linha (nunca 0 — Ink sempre desenha ao menos uma linha)", () => {
    assert.equal(countWrappedLines("", 40), 1);
});

test("countWrappedLines: texto menor que a largura conta 1 linha", () => {
    assert.equal(countWrappedLines("oi", 40), 1);
});

test("countWrappedLines: quebra por palavra, contagem bate com o número real de linhas quebradas", () => {
    const text = "uma frase bem mais longa do que a largura disponível pro terminal";
    const n = countWrappedLines(text, 20);
    assert.ok(n > 1, "deveria quebrar em mais de 1 linha");
});

test("countWrappedLines: newline explícito sempre gera pelo menos uma linha a mais", () => {
    assert.equal(countWrappedLines("linha 1\nlinha 2", 40), 2);
});

test("countWrappedLines: códigos ANSI (cor) não contam como largura visível", () => {
    const colored = "[36mHelena[39m:";
    // "Helena:" tem 7 chars visíveis, cabe fácil numa largura de 40 -> 1 linha,
    // mesmo com os bytes de escape no meio da string.
    assert.equal(countWrappedLines(colored, 40), 1);
});

test("measureHistoryItem: resposta da Helena é inline (rótulo na mesma linha do texto) dentro de uma caixa", async () => {
    const { measureHistoryItem } = await import("./viewport.ts");
    const { MESSAGE_PADDING_Y } = await import("./theme.ts");
    const item = { id: "1", role: "assistant", text: "oi" } as never;
    // "Helena: oi" cabe em 1 linha => 1 + padding vertical da caixa (topo+base) + 1 de margem
    assert.equal(measureHistoryItem(item, 40), 1 + 2 * MESSAGE_PADDING_Y + 1);
});

test("measureHistoryItem: caixas descontam o padding lateral da largura (texto que caberia em 40 quebra em 40-2*padding)", async () => {
    const { measureHistoryItem } = await import("./viewport.ts");
    const { MESSAGE_PADDING_X, MESSAGE_PADDING_Y } = await import("./theme.ts");
    const usable = 40 - 2 * MESSAGE_PADDING_X;
    // "Você: " (6) + texto = exatamente `usable + 1` colunas → 2 linhas; com `usable` colunas → 1 linha
    const fits = { id: "1", role: "user", text: "x".repeat(usable - 6) } as never;
    const overflows = { id: "2", role: "user", text: "x".repeat(usable - 5) } as never;
    assert.equal(measureHistoryItem(fits, 40), 1 + 2 * MESSAGE_PADDING_Y + 1);
    assert.equal(measureHistoryItem(overflows, 40), 2 + 2 * MESSAGE_PADDING_Y + 1);
});

test("measureDraftBubble: sem texto ainda = só a linha do spinner dentro da bolha; com texto soma as linhas dele", () => {
    // paddingY 1 em cima + 1 embaixo + 1 de margem = 3 linhas fixas
    assert.equal(measureDraftBubble("", "Helena está pensando...", 80), 1 + 3);
    assert.equal(measureDraftBubble("oi", "Helena está escrevendo...", 80), 2 + 3);
    // markdown pela metade (stream) nunca lança
    assert.ok(measureDraftBubble("```js\nconst a = 1\n**negrito", "x", 40) >= 4);
});
