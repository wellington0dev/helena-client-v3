import { test } from "node:test";
import assert from "node:assert/strict";
import { countWrappedLines, fitToViewport } from "./viewport.ts";

test("fitToViewport: tudo cabe -> mostra do início ao fim, sem scroll em nenhuma direção", () => {
    const r = fitToViewport([1, 1, 1], 10, 3);
    assert.deepEqual(r, { start: 0, end: 3, canScrollUp: false, canScrollDown: false });
});

test("fitToViewport: orçamento menor que o total -> corta os itens mais ANTIGOS (do início)", () => {
    // alturas [3,2,4,1], maxRows=6, end=4 (grudado no fim) -> anda de trás pra
    // frente: 1 (soma 1) + 4 (soma 5) + 2 estouraria (soma 7 > 6) -> para
    const r = fitToViewport([3, 2, 4, 1], 6, 4);
    assert.deepEqual(r, { start: 2, end: 4, canScrollUp: true, canScrollDown: false });
});

test("fitToViewport: nunca inclui um item PELA METADE — estourou o orçamento, o item de fora fica de fora inteiro", () => {
    const r = fitToViewport([5, 3], 4, 2);
    // o item de altura 3 (o mais novo) cabe sozinho; o de altura 5 estoura o
    // orçamento restante (3+5=8 > 4) e fica de FORA por inteiro, nunca cortado.
    assert.deepEqual(r, { start: 1, end: 2, canScrollUp: true, canScrollDown: false });
});

test("fitToViewport: end < tamanho da lista revela itens mais antigos, escondendo os mais novos (canScrollDown=true)", () => {
    const r = fitToViewport([1, 1, 1, 1], 10, 2);
    assert.deepEqual(r, { start: 0, end: 2, canScrollUp: false, canScrollDown: true });
});

test("fitToViewport: `end` é ÍNDICE ABSOLUTO, não distância do fim — a janela NÃO anda sozinha quando a lista cresce por trás", () => {
    // Simula: usuário parou de ler no índice 2 (end=2) enquanto só existiam 2
    // itens. Chega mensagem nova em segundo plano (lista cresce pra 5) — a
    // janela visível tem que continuar EXATAMENTE a mesma, sem se mexer.
    const before = fitToViewport([1, 1], 10, 2);
    const after = fitToViewport([1, 1, 1, 1, 1], 10, 2);
    assert.deepEqual(before, { start: 0, end: 2, canScrollUp: false, canScrollDown: false });
    assert.deepEqual(after, { start: 0, end: 2, canScrollUp: false, canScrollDown: true });
    assert.equal(before.start, after.start);
    assert.equal(before.end, after.end);
});

test("fitToViewport: `end` negativo é clampado pra 0, nunca vira índice inválido", () => {
    const r = fitToViewport([1, 1], 10, -5);
    assert.deepEqual(r, { start: 0, end: 0, canScrollUp: false, canScrollDown: true });
});

test("fitToViewport: `end` maior que o tamanho da lista é clampado pro próprio tamanho", () => {
    const r = fitToViewport([1, 1], 10, 999);
    assert.deepEqual(r, { start: 0, end: 2, canScrollUp: false, canScrollDown: false });
});

test("fitToViewport: lista vazia nunca lança, devolve janela vazia sem scroll", () => {
    const r = fitToViewport([], 10, 0);
    assert.deepEqual(r, { start: 0, end: 0, canScrollUp: false, canScrollDown: false });
});

test("fitToViewport: maxRows <= 0 nunca inclui nada (terminal minúsculo demais)", () => {
    const r = fitToViewport([1, 1, 1], 0, 3);
    assert.deepEqual(r, { start: 3, end: 3, canScrollUp: true, canScrollDown: false });
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
