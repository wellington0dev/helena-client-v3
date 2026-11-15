import { parseBlocks, type Block, type FormItem, type InlineNode } from "./markdown.ts";

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

/**
 * Um botão de inline keyboard: o que aparece pro contato e o TEXTO que ele sintetiza como resposta
 * quando clicado — mesmo protocolo do painel web (web-app/src/app/shared/chat-panel/markdown-blocks.ts):
 * select de escolha única manda "Pergunta: opção"; botão avulso manda o próprio texto.
 */
export interface TelegramButton {
    text: string;
    answer: string;
}

/** Uma linha do `inline_keyboard` (o Telegram empilha as linhas; cada uma pode ter alguns botões lado a lado). */
export type TelegramButtonRow = TelegramButton[];

export interface TelegramContent {
    /** HTML (`parse_mode: 'HTML'`) do texto da mensagem — nunca vazio quando `rows` existe (o Telegram recusa mensagem sem texto). */
    html: string;
    /** Linhas de botões pro `reply_markup.inline_keyboard`. Vazio = mensagem sem interação (manda só texto). */
    rows: TelegramButtonRow[];
}

/** Select de escolha MÚLTIPLA não cabe num clique só (precisa marcar N opções e confirmar) — degrada igual aos canais sem widget. */
function degradedSelect(block: Extract<Block, { kind: 'select' }>): string {
    return [block.label, ...block.options.map((o, i) => `${i + 1}. ${o.text}`), '(responda com o número ou o texto da opção)'].join('\n');
}

/** Form com `<input>`/`<select>` exige que a pessoa DIGITE os campos — botão de inline keyboard não coleta valor —, então degrada pro formato "campo: valor" de sempre. */
function degradedForm(block: Extract<Block, { kind: 'form' }>): string {
    return [
        block.label,
        ...block.items.filter((it) => it.kind !== 'button').map((it, i) => `${i + 1}. ${it.label}`),
        '(responda tudo numa mensagem só, no formato campo: valor)',
    ]
        .filter((line): line is string => Boolean(line))
        .join('\n');
}

/** Decide o HTML (e, de quebra, acumula as linhas de botão) de um bloco interativo — ver `toTelegramContent`. */
function renderTelegramInteractive(block: Extract<Block, { kind: 'select' | 'form' | 'button' }>, rows: TelegramButtonRow[]): string {
    if (block.kind === 'button') {
        rows.push([{ text: block.text, answer: block.text }]);
        return ''; // o botão já aparece embaixo da mensagem — não duplica o texto em cima
    }

    if (block.kind === 'select') {
        if (block.multiple) return degradedSelect(block); // múltipla: degrada (precisa marcar N + confirmar)
        rows.push(block.options.map((o) => ({ text: o.text, answer: `${block.label}: ${o.text}` })));
        return escapeTelegramHtml(block.label);
    }

    // form
    const buttons = block.items.filter((it): it is Extract<FormItem, { kind: 'button' }> => it.kind === 'button');
    const hasFields = block.items.some((it) => it.kind !== 'button');
    if (hasFields || buttons.length === 0) return degradedForm(block); // tem campo pra digitar: degrada tudo
    rows.push(buttons.map((b) => ({ text: b.text, answer: b.text })));
    return block.label ? escapeTelegramHtml(block.label) : '';
}

/**
 * Versão do `toTelegramHtml` que EXTRAI os blocos interativos (`<select>` de escolha única e `<button>`,
 * além de `<form>` só de botões) pra um teclado NATIVO do Telegram em vez de degradá-los pra texto
 * numerado — o diferencial que o Telegram tem e o WhatsApp não (docs/formato-interativo-chat.md §6).
 * O `answer` de cada botão é o texto equivalente que o clique manda como mensagem normal pro
 * backend-v2, então o contrato com o agente não muda (ver handleCallbackQuery em telegram.ts).
 *
 * `<select multiple>`, `<form>` com campos e `<box>` aninhado seguem a MESMA degradação do
 * `toTelegramHtml`. Botão avulso e form só de botões viram botões e NÃO duplicam o texto na mensagem —
 * por isso o fallback: se o texto ficou vazio, usa o rótulo dos próprios botões (nunca manda vazio).
 */
export function toTelegramContent(text: string): TelegramContent {
    const rows: TelegramButtonRow[] = [];
    const html = blocksToText(parseBlocks(text), {
        inline: inlineToTelegramHtml,
        heading: (line) => `<b>${line}</b>`,
        listPrefix: (ordered, i) => (ordered ? `${i + 1}. ` : '• '),
        hr: '──────────',
        codeblock: (code) => `<pre>${escapeTelegramHtml(code)}</pre>`,
        interactive: (block) => renderTelegramInteractive(block, rows),
    }).trim();

    return {
        html: html || rows.flat().map((b) => escapeTelegramHtml(b.text)).join('\n'),
        rows,
    };
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
    /**
     * Opcional: quando presente, `<select>`/`<form>`/`<button>` viram botões nativos (o HTML devolvido
     * substitui a degradação) em vez de texto numerado. Sem isto — WhatsApp e o reply de GRUPO do
     * Telegram — vale a degradação de sempre. Só o `toTelegramContent` passa isto hoje.
     */
    interactive?: (block: Extract<Block, { kind: 'select' | 'form' | 'button' }>) => string;
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
                rendered.push(opts.interactive ? opts.interactive(block) : degradedSelect(block));
                break;
            case 'form':
                rendered.push(opts.interactive ? opts.interactive(block) : degradedForm(block));
                break;
            case 'button':
                rendered.push(opts.interactive ? opts.interactive(block) : block.text);
                break;
        }
    }

    // Interativo pode devolver '' de propósito (botão vira teclado, nada a mostrar no texto) — não deixa virar linha em branco.
    return rendered.filter((part) => part !== '').join('\n\n');
}
