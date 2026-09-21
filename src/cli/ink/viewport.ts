import wrapAnsi from "wrap-ansi";
import { formatToolCall, formatToolResult } from "./format-tool-call.ts";
import { formatUsageLine } from "./format-usage.ts";
import { renderMarkdownAnsi } from "./render-markdown.ts";
import type { HistoryItem } from "./history-item.ts";

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
    if (item.role === "notice") {
        return countWrappedLines(item.text, columns) + 1;
    }
    if (item.role === "usage") {
        return countWrappedLines(formatUsageLine(item.usage), columns) + 1;
    }
    if (item.role === "user") {
        // Inline ("Você: <texto>", uma unidade só que quebra como
        // parágrafo) — tem que medir a MESMA string concatenada que
        // HistoryLine desenha, não rótulo e corpo separados.
        return countWrappedLines(`Você: ${item.text}`, columns) + 1;
    }
    return countWrappedLines("Helena:", columns) + countWrappedLines(renderMarkdownAnsi(item.text), columns) + 1;
}

/**
 * Puro e testável de propósito (ver viewport.test.ts) — recebe as alturas
 * JÁ calculadas (não os itens em si, pra não acoplar em HistoryItem) e
 * devolve o intervalo `[start, end)` que cabe em `maxRows`, andando de
 * TRÁS pra frente a partir de `end` (limite ABSOLUTO, não uma distância
 * do fim da lista atual). Nunca inclui um item pela metade — estoura o
 * orçamento, para ANTES dele.
 *
 * `end` é âncora por ÍNDICE de propósito, não "distância do fim": se
 * fosse distância, a janela ANDARIA sozinha toda vez que uma mensagem
 * nova chegasse em segundo plano (history.length mudando por baixo dos
 * pés de quem tá lendo um trecho antigo). Com âncora fixa, `end =
 * history.length` sempre acompanha o mais novo (recalculado a cada
 * render, já que a própria referência cresce), e qualquer outro número
 * fica PARADO — a leitura não se move até o usuário pedir (PageUp/
 * PageDown, ver app.ts).
 */
export function fitToViewport(
    heights: number[],
    maxRows: number,
    end: number,
): { start: number; end: number; canScrollUp: boolean; canScrollDown: boolean } {
    const n = heights.length;
    const clampedEnd = Math.max(0, Math.min(end, n));
    let start = clampedEnd;
    let used = 0;
    while (start > 0) {
        const h = heights[start - 1] ?? 0;
        if (used + h > maxRows) break;
        used += h;
        start--;
    }
    return { start, end: clampedEnd, canScrollUp: start > 0, canScrollDown: clampedEnd < n };
}
