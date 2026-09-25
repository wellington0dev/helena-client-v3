import wrapAnsi from "wrap-ansi";
import { formatToolCall, formatToolResult } from "./format-tool-call.ts";
import { renderMarkdownAnsi } from "./render-markdown.ts";
import type { HistoryItem } from "./history-item.ts";
import { MESSAGE_PADDING_X, MESSAGE_PADDING_Y, NOTICE_PADDING_Y } from "./theme.ts";

/**
 * Medição de altura pro fullscreen (alt-screen, ver app.ts/chat.ts) — no
 * buffer alternativo não existe scrollback: se a gente mandar renderizar
 * mais linhas do que `rows` do terminal, o excesso simplesmente ROLA PRA
 * FORA e SOME (ao contrário do modo normal, onde o terminal guarda tudo).
 * Por isso a altura de cada item do histórico precisa ser calculada
 * ANTES de decidir o que entra na tela — nunca deixar o Ink renderizar
 * tudo e "torcer" pra caber.
 *
 * `wrap-ansi`/`string-width` aqui são EXATAMENTE os mesmos pacotes que o
 * `ink` usa internamente pra quebrar `<Text>` (ver node_modules/ink/
 * build/wrap-text.js — mesmas opções `{trim:false, hard:true}` do modo
 * "wrap", que é o default do componente `Text`) — dependência direta
 * deste projeto (package.json), fixada nas versões que o `ink` pede, pra
 * não depender de hoisting acidental do npm continuar apontando pro
 * mesmo pacote. Contagem por construção = igual ao que o Ink desenha,
 * não uma estimativa (ceil(len/largura) SUBconta quebra de palavra).
 */
export function countWrappedLines(text: string, width: number): number {
    const safeWidth = Math.max(1, Math.floor(width));
    if (text === "") return 1;
    return wrapAnsi(text, safeWidth, { trim: false, hard: true }).split("\n").length;
}

/**
 * Réplica em NÚMERO DE LINHAS do que `HistoryLine` (app.ts) desenha pra
 * cada tipo de item — mesmos textos (reaproveita os MESMOS formatadores),
 * mesma largura efetiva por tipo (ex: `tool_result` tem `paddingLeft:2`,
 * então sobra `columns - 2`), e a linha em branco de `marginBottom:1`
 * contada como +1. Se `HistoryLine` mudar de layout, este cálculo tem
 * que mudar junto — é o preço de não ter um jeito nativo no Ink de medir
 * altura sem renderizar primeiro (ver measureElement/useBoxMetrics: exigem
 * o elemento já commitado, o que forçaria um ciclo render→mede→re-renderiza
 * a cada mudança de histórico, só pra descobrir quantos itens cabem).
 */
export function measureHistoryItem(item: HistoryItem, columns: number): number {
    if (item.role === "tool_call") {
        return countWrappedLines(`● ${formatToolCall(item.name, item.input)}`, columns);
    }
    if (item.role === "tool_result") {
        return countWrappedLines(`⎿ ${formatToolResult(item.name, item.output)}`, columns - 2) + 1;
    }
    // Avisos e mensagens são CAIXAS coloridas (ver HistoryLine): largura útil = colunas - padding lateral; altura += padding vertical.
    const boxWidth = columns - 2 * MESSAGE_PADDING_X;
    const boxPadding = 2 * MESSAGE_PADDING_Y;
    if (item.role === "notice") {
        return countWrappedLines(item.text, boxWidth) + 2 * NOTICE_PADDING_Y + 1;
    }
    if (item.role === "user") {
        // Inline ("Você: <texto>", uma unidade só que quebra como
        // parágrafo) — tem que medir a MESMA string concatenada que
        // HistoryLine desenha, não rótulo e corpo separados.
        return countWrappedLines(`Você: ${item.text}`, boxWidth) + boxPadding + 1;
    }
    // Inline como "Você:" (rótulo + resposta na MESMA linha) — mesma string concatenada que HistoryLine desenha.
    return countWrappedLines(`Helena: ${renderMarkdownAnsi(item.text)}`, boxWidth) + boxPadding + 1;
}

/**
 * Bolha da resposta "ainda carregando" (DraftBubble em app.ts): texto que já chegou em stream (se houver) + linha do
 * spinner com o que a Helena está fazendo. Mesmas caixas/paddings da mensagem da Helena.
 */
export function measureDraftBubble(draft: string, status: string, columns: number, thinking = ""): number {
    const boxWidth = columns - 2 * MESSAGE_PADDING_X;
    const textRows = draft ? countWrappedLines(`Helena: ${renderMarkdownAnsi(draft)}`, boxWidth) : 0;
    const thinkingRows = draft ? 0 : thinkingSnippet(thinking, boxWidth).length;
    // Spinner (1 col) + gap (1) antes do texto do Loader.
    return textRows + thinkingRows + countWrappedLines(status, boxWidth - 2) + 2 * MESSAGE_PADDING_Y + 1;
}

/** Quantas linhas do raciocínio aparecem no "carregando" — as ÚLTIMAS (o que ela está pensando agora), nunca a bolha inteira. */
export const THINKING_MAX_LINES = 4;

/**
 * Últimas linhas do raciocínio, já quebradas na largura (cada uma cabe numa linha — o render usa `wrap:"truncate"`,
 * então a contagem é exata). Linhas em branco saem: o resumo do Gemini vem cheio de parágrafos vazios.
 */
export function thinkingSnippet(thinking: string, width: number, maxLines = THINKING_MAX_LINES): string[] {
    const rendered = renderMarkdownAnsi(thinking).trim();
    if (!rendered) return [];
    const lines = wrapAnsi(rendered, Math.max(1, Math.floor(width)), { trim: true, hard: true })
        .split("\n")
        .filter((line) => line.trim().length > 0);
    return lines.slice(-maxLines);
}

export interface VisibleSlice {
    index: number;
    /** Linhas do item escondidas ACIMA da janela (0 = começa inteiro). */
    clipTop: number;
    /** Linhas do item que aparecem — menor que a altura dele = cortado em cima e/ou embaixo. */
    rows: number;
}

/**
 * Janela por LINHA (2026-09-24) — puro e testável (ver viewport.test.ts). Recebe as alturas JÁ calculadas e `bottom`,
 * a linha ABSOLUTA (contada do topo do histórico, exclusiva) onde a janela termina; `null` = grudado no fim.
 *
 * Antes a janela andava por item inteiro e "nunca incluía um item pela metade": uma resposta mais alta que a tela
 * (pesquisa longa) não cabia nunca e o chat ficava VAZIO. Agora o item que não cabe aparece cortado, e PageUp/PageDown
 * andam por linhas dentro dele.
 *
 * `bottom` é absoluto de propósito (mesmo motivo da âncora por índice de antes): mensagem nova chegando por baixo não
 * mexe no trecho que o dono está lendo — só `null` acompanha o fim.
 */
export function fitLines(
    heights: number[],
    maxRows: number,
    bottom: number | null,
): { items: VisibleSlice[]; bottom: number; top: number; total: number; canScrollUp: boolean; canScrollDown: boolean } {
    const total = heights.reduce((sum, h) => sum + Math.max(0, h), 0);
    const rows = Math.max(0, Math.floor(maxRows));
    const end = bottom === null ? total : Math.max(Math.min(rows, total), Math.min(Math.floor(bottom), total));
    const top = Math.max(0, end - rows);
    const items: VisibleSlice[] = [];
    let start = 0;
    heights.forEach((raw, index) => {
        const h = Math.max(0, raw);
        const itemEnd = start + h;
        const from = Math.max(start, top);
        const to = Math.min(itemEnd, end);
        if (to > from) items.push({ index, clipTop: from - start, rows: to - from });
        start = itemEnd;
    });
    return { items, bottom: end, top, total, canScrollUp: top > 0, canScrollDown: end < total };
}

/**
 * Roda do mouse (e qualquer rolagem fina): anda `delta` linhas a partir da âncora atual (`null` = fim). Negativo sobe.
 * Nunca passa do topo (tela cheia) e, ao chegar no fim, devolve `null` (volta a grudar no mais novo).
 */
export function scrollByLines(anchor: number | null, delta: number, total: number, maxRows: number): number | null {
    const next = Math.max(Math.min(maxRows, total), (anchor ?? total) + delta);
    return next >= total ? null : next;
}

/** PageUp: sobe uma tela menos 1 linha (a última linha vista continua na tela, pra não perder o fio). */
export function pageUp(view: { bottom: number; total: number }, maxRows: number): number | null {
    const step = Math.max(1, maxRows - 1);
    return Math.max(Math.min(maxRows, view.total), view.bottom - step);
}

/** PageDown: desce uma tela menos 1 linha; chegou no fim → `null` (volta a grudar no mais novo). */
export function pageDown(view: { bottom: number; total: number }, maxRows: number): number | null {
    const next = view.bottom + Math.max(1, maxRows - 1);
    return next >= view.total ? null : next;
}
