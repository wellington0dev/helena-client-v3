import { parseBlocks, type Block, type InlineNode } from "./markdown.ts";

/**
 * Traduz o markdown que a Helena escreve (mesma gramática do painel web —
 * ver markdown.ts) pro dialeto de formatação de cada canal de mensagem.
 * Sem isso, WhatsApp/Telegram mandavam `**negrito**`/`` `código` ``/
 * `[link](url)` cru — o Telegram simplesmente ignora essa sintaxe (mostra os
 * asteriscos/colchetes literais), e o WhatsApp usa uma sintaxe PARECIDA mas
 * diferente (`*negrito*` com um asterisco só, não dois).
 *
 * Chamado sobre `cleanedText` (depois de `attachments.ts#extractAttachments`
 * já ter tirado as imagens do texto) — `image` nodes não deveriam aparecer
 * aqui na prática, mas são tratados (vira link cru) por segurança.
 */

function escapeTelegramHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineToTelegramHtml(nodes: InlineNode[]): string {
    return nodes.map((node) => {
        switch (node.kind) {
            case 'bold': return `<b>${escapeTelegramHtml(node.text)}</b>`;
            case 'italic': return `<i>${escapeTelegramHtml(node.text)}</i>`;
            case 'code': return `<code>${escapeTelegramHtml(node.text)}</code>`;
            case 'image': return `<a href="${escapeTelegramHtml(node.url)}">${escapeTelegramHtml(node.alt || node.url)}</a>`;
            case 'link': return `<a href="${escapeTelegramHtml(node.url)}">${escapeTelegramHtml(node.text)}</a>`;
            case 'text': return escapeTelegramHtml(node.text);
        }
    }).join('');
}

/** HTML do Telegram (`parse_mode: 'HTML'`) — mais previsível que MarkdownV2, que exige escapar ~15 caracteres especiais em todo texto não-formatado. */
export function toTelegramHtml(text: string): string {
    return blocksToText(parseBlocks(text), {
        inline: inlineToTelegramHtml,
        heading: (line) => `<b>${line}</b>`,
        listPrefix: (ordered, i) => (ordered ? `${i + 1}. ` : '• '),
        hr: '──────────',
        codeblock: (code) => `<pre>${escapeTelegramHtml(code)}</pre>`
    });
}

function inlineToWhatsapp(nodes: InlineNode[]): string {
    return nodes.map((node) => {
        switch (node.kind) {
            case 'bold': return `*${node.text}*`; // WhatsApp: UM asterisco pra negrito, não dois
            case 'italic': return `_${node.text}_`;
            case 'code': return `\`${node.text}\``;
            case 'image': return `${node.alt ? `${node.alt}: ` : ''}${node.url}`;
            case 'link': return `${node.text}: ${node.url}`; // WhatsApp não suporta link com texto customizado
            case 'text': return node.text;
        }
    }).join('');
}

/** Dialeto próprio do WhatsApp — parecido com markdown mas não igual (negrito com 1 asterisco, sem sintaxe de link). Bloco de código: WhatsApp já suporta ```texto``` nativamente, então só preserva os delimitadores. */
export function toWhatsappText(text: string): string {
    return blocksToText(parseBlocks(text), {
        inline: inlineToWhatsapp,
        heading: (line) => `*${line}*`,
        listPrefix: (ordered, i) => (ordered ? `${i + 1}. ` : '- '),
        hr: '──────────',
        codeblock: (code) => `\`\`\`${code}\`\`\``
    });
}

interface RenderOptions {
    inline: (nodes: InlineNode[]) => string;
    heading: (renderedLine: string) => string;
    listPrefix: (ordered: boolean, index: number) => string;
    hr: string;
    codeblock: (text: string) => string;
}

// Blocos são separados por linha em branco (\n\n); DENTRO de uma lista, os
// itens ficam um embaixo do outro sem linha em branco entre eles.
function blocksToText(blocks: Block[], opts: RenderOptions): string {
    const rendered: string[] = [];

    for (const block of blocks) {
        switch (block.kind) {
            case 'heading':
                rendered.push(opts.heading(opts.inline(block.inline)));
                break;
            case 'hr':
                rendered.push(opts.hr);
                break;
            case 'list':
                rendered.push(block.items.map((item, i) => `${opts.listPrefix(block.ordered, i)}${opts.inline(item)}`).join('\n'));
                break;
            case 'codeblock':
                rendered.push(opts.codeblock(block.text));
                break;
            case 'paragraph':
                rendered.push(opts.inline(block.inline));
                break;
            // Blocos interativos (docs/formato-interativo-chat.md) — o modelo nunca deveria gerar essas tags
            // fora do painel/CLI (só `defineChatAgent` aprende a sintaxe), mas o switch precisa tratar todo
            // `Block.kind` mesmo assim: rede de segurança contra vazamento acidental pra WhatsApp/Telegram, onde
            // não dá pra renderizar um widget clicável — degrada pra texto simples numerado.
            case 'box': {
                const title = block.title ? `${opts.heading(block.title)}\n` : '';
                rendered.push(`${title}${blocksToText(block.content, opts)}`);
                break;
            }
            case 'select':
                rendered.push(
                    [block.label, ...block.options.map((o, i) => `${opts.listPrefix(true, i)}${o.text}`), '(responda com o número ou o texto da opção)'].join('\n'),
                );
                break;
            case 'form':
                rendered.push(
                    [
                        block.label,
                        ...block.items.filter((it) => it.kind !== 'button').map((it, i) => `${opts.listPrefix(true, i)}${it.label}`),
                        '(responda tudo numa mensagem só, no formato campo: valor)',
                    ]
                        .filter((line): line is string => Boolean(line))
                        .join('\n'),
                );
                break;
            case 'button':
                rendered.push(block.text);
                break;
        }
    }

    return rendered.join('\n\n');
}
