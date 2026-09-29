import chalk from "chalk";
import { c } from "./theme.ts";
import { hideIncompleteTag, parseBlocks, type Block, type InlineNode } from "../../channels/markdown.ts";

/**
 * Renderer ANSI da MESMA árvore de `channels/markdown.ts` (que já serve
 * `toTelegramHtml`/`toWhatsappText` em markdown-format.ts) — em vez de
 * outro parser, é só mais um "dialeto" pro terminal, seguindo o mesmo
 * padrão "um parser, N renderers". Usado dentro de `<Text>` do Ink: a
 * string devolvida já carrega os códigos ANSI de verdade (Ink escreve o
 * conteúdo de `<Text>` como veio, então um `chalk.bold(...)` aninhado
 * funciona igual imprimir direto no terminal).
 *
 * ESTÁTICO de propósito — box/select/form aqui sempre viram texto simples
 * (numerado/rotulado), nunca clicável. É o modo "somente leitura" usado
 * pro rascunho em streaming e pro histórico (ver docs/formato-interativo-
 * chat.md §3/§4) — a versão CLICÁVEL da última mensagem é montada à parte
 * (componente Ink de verdade, reaproveitando Form/SelectMenu), fora deste
 * arquivo.
 */
function inlineToAnsi(nodes: InlineNode[]): string {
    return nodes
        .map((node) => {
            switch (node.kind) {
                case "bold":
                    return chalk.bold(node.text);
                case "italic":
                    return chalk.italic(node.text);
                case "code":
                    return c.code(`\`${node.text}\``);
                case "link":
                    return `${chalk.underline(node.text)} ${chalk.dim(`(${node.url})`)}`;
                case "image":
                    return chalk.dim(`[imagem: ${node.alt || node.url}]`);
                case "text":
                    return node.text;
            }
        })
        .join("");
}

function renderBlocksAnsi(blocks: Block[]): string[] {
    const rendered: string[] = [];
    for (const block of blocks) {
        switch (block.kind) {
            case "heading":
                rendered.push(chalk.bold.underline(inlineToAnsi(block.inline)));
                break;
            case "hr":
                rendered.push(chalk.dim("──────────"));
                break;
            case "list":
                rendered.push(block.items.map((item, i) => `${block.ordered ? `${i + 1}. ` : "• "}${inlineToAnsi(item)}`).join("\n"));
                break;
            case "codeblock":
                rendered.push(c.muted(block.text));
                break;
            case "paragraph":
                rendered.push(inlineToAnsi(block.inline));
                break;
            case "box": {
                const title = block.title ? `${chalk.bold(block.title)}\n` : "";
                const inner = renderBlocksAnsi(block.content)
                    .join("\n\n")
                    .split("\n")
                    .map((line) => `${chalk.dim("│")} ${line}`)
                    .join("\n");
                rendered.push(`${title}${inner}`);
                break;
            }
            case "select":
                rendered.push(
                    [chalk.bold(block.label), ...block.options.map((opt, i) => `  ${i + 1}. ${opt.text}`), c.muted("(responda com o número ou o texto da opção)")].join("\n"),
                );
                break;
            case "form":
                rendered.push(
                    [
                        block.label ? chalk.bold(block.label) : undefined,
                        ...block.items.filter((it) => it.kind !== "button").map((it) => `  ${it.kind === "select" ? it.label : it.label}:`),
                        c.muted("(responda tudo numa mensagem só, no formato campo: valor)"),
                    ]
                        .filter((line): line is string => line !== undefined)
                        .join("\n"),
                );
                break;
            case "button":
                rendered.push(c.muted(`▸ ${block.text}`));
                break;
        }
    }
    return rendered;
}

export function renderMarkdownAnsi(text: string): string {
    return renderBlocksAnsi(parseBlocks(text)).join("\n\n");
}

/**
 * Mesma coisa, mas pro RASCUNHO em streaming (`draft`, ver app.ts/viewport.ts) — aplica
 * `hideIncompleteTag` antes de renderizar, pra nunca mostrar bloco interativo pela metade. `measureDraftBubble`
 * (viewport.ts) e a renderização de verdade (app.ts) PRECISAM chamar exatamente esta função (nunca
 * `renderMarkdownAnsi(draft)` direto), senão a altura medida diverge do que é desenhado.
 */
export function renderDraftAnsi(draft: string): string {
    return renderMarkdownAnsi(hideIncompleteTag(draft));
}
