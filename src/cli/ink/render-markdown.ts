import chalk from "chalk";
import { c } from "./theme.ts";
import { parseBlocks, type InlineNode } from "../../channels/markdown.ts";

/**
 * Renderer ANSI da MESMA árvore de `channels/markdown.ts` (que já serve
 * `toTelegramHtml`/`toWhatsappText` em markdown-format.ts) — em vez de
 * outro parser, é só mais um "dialeto" pro terminal, seguindo o mesmo
 * padrão "um parser, N renderers". Usado dentro de `<Text>` do Ink: a
 * string devolvida já carrega os códigos ANSI de verdade (Ink escreve o
 * conteúdo de `<Text>` como veio, então um `chalk.bold(...)` aninhado
 * funciona igual imprimir direto no terminal).
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

export function renderMarkdownAnsi(text: string): string {
    const rendered: string[] = [];
    for (const block of parseBlocks(text)) {
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
        }
    }
    return rendered.join("\n\n");
}
