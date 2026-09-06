/**
 * Parser de markdown mínimo — MESMA gramática (e mesmo arquivo-fonte,
 * duplicado de propósito, não importado) de client/src/channels/markdown.ts
 * (que por sua vez documenta a cadeia de duplicação anterior: backend/,
 * web/, cli/ — todos pacotes TS totalmente separados, nunca importam uns
 * dos outros). Aqui vira a base pra markdown-html.ts, que traduz essa
 * árvore pra HTML seguro (bolha de chat do painel) — igual
 * markdown-format.ts faz pro dialeto de WhatsApp/Telegram do lado do
 * client/. Qualquer mudança de gramática num lado precisa ser espelhada
 * nos outros.
 */

export type InlineNode =
    | { kind: "text"; text: string }
    | { kind: "bold"; text: string }
    | { kind: "italic"; text: string }
    | { kind: "code"; text: string }
    | { kind: "image"; alt: string; url: string }
    | { kind: "link"; text: string; url: string };

export type Block =
    | { kind: "heading"; level: 1 | 2 | 3; inline: InlineNode[] }
    | { kind: "hr" }
    | { kind: "list"; ordered: boolean; items: InlineNode[][] }
    | { kind: "codeblock"; text: string }
    | { kind: "paragraph"; inline: InlineNode[] };

// Ordem importa: !imagem antes de link comum (senão "![alt](url)" casaria
// como link "[alt](url)" com um "!" solto sobrando); **negrito** antes de
// *itálico* (senão o primeiro `*` de "**x**" já casaria como abertura de
// itálico sozinho).
const INLINE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]*)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g;

export function parseInline(text: string): InlineNode[] {
    const nodes: InlineNode[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(INLINE_PATTERN)) {
        const index = match.index ?? 0;
        if (index > lastIndex) nodes.push({ kind: "text", text: text.slice(lastIndex, index) });

        const [full, imgAlt, imgUrl, linkText, linkUrl, bold, italic, code] = match;
        if (imgUrl !== undefined) nodes.push({ kind: "image", alt: imgAlt ?? "", url: imgUrl });
        else if (linkUrl !== undefined) nodes.push({ kind: "link", text: linkText || linkUrl, url: linkUrl });
        else if (bold !== undefined) nodes.push({ kind: "bold", text: bold });
        else if (italic !== undefined) nodes.push({ kind: "italic", text: italic });
        else if (code !== undefined) nodes.push({ kind: "code", text: code });

        lastIndex = index + full.length;
    }
    if (lastIndex < text.length) nodes.push({ kind: "text", text: text.slice(lastIndex) });
    return nodes.length ? nodes : [{ kind: "text", text }];
}

const HEADING = /^(#{1,3})\s+(.+)$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/;
const UL_ITEM = /^[-*]\s+(.+)$/;
const OL_ITEM = /^\d+\.\s+(.+)$/;
const CODE_FENCE = /^```/;

export function parseBlocks(text: string): Block[] {
    const lines = text.split("\n");
    const blocks: Block[] = [];

    let paragraphLines: string[] = [];
    let listItems: string[] = [];
    let listOrdered = false;

    const flushParagraph = () => {
        if (paragraphLines.length) {
            blocks.push({ kind: "paragraph", inline: parseInline(paragraphLines.join("\n")) });
            paragraphLines = [];
        }
    };
    const flushList = () => {
        if (listItems.length) {
            blocks.push({ kind: "list", ordered: listOrdered, items: listItems.map((line) => parseInline(line)) });
            listItems = [];
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i]!;
        const line = rawLine.trim();

        // Bloco de código (```lang ... ```) — texto CRU até o fechamento,
        // nunca processado como inline (senão um "*" dentro do código viraria
        // itálico por engano). Linguagem depois da crase (ex: ```text) é só
        // descartada — nenhum canal de mensagem faz syntax highlighting.
        if (CODE_FENCE.test(line)) {
            flushParagraph();
            flushList();
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !CODE_FENCE.test(lines[i]!.trim())) {
                codeLines.push(lines[i]!);
                i++;
            }
            blocks.push({ kind: "codeblock", text: codeLines.join("\n") });
            continue;
        }

        if (!line) {
            flushParagraph();
            flushList();
            continue;
        }

        const heading = HEADING.exec(line);
        if (heading) {
            flushParagraph();
            flushList();
            blocks.push({ kind: "heading", level: heading[1]!.length as 1 | 2 | 3, inline: parseInline(heading[2]!) });
            continue;
        }

        if (HR.test(line)) {
            flushParagraph();
            flushList();
            blocks.push({ kind: "hr" });
            continue;
        }

        const ul = UL_ITEM.exec(line);
        if (ul) {
            flushParagraph();
            if (listItems.length && listOrdered) flushList();
            listOrdered = false;
            listItems.push(ul[1]!);
            continue;
        }

        const ol = OL_ITEM.exec(line);
        if (ol) {
            flushParagraph();
            if (listItems.length && !listOrdered) flushList();
            listOrdered = true;
            listItems.push(ol[1]!);
            continue;
        }

        flushList();
        paragraphLines.push(rawLine);
    }
    flushParagraph();
    flushList();

    return blocks;
}
