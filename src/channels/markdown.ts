/**
 * Parser de markdown mínimo — MESMA gramática (e mesmo arquivo-fonte, duplicado de propósito, não importado)
 * de web-app/src/app/shared/chat-panel/markdown.ts (repo `helena-web-v3`): título `#`/`##`/`###`, negrito/
 * itálico, `---` como separador, listas, código inline/em bloco (```), imagem `![alt](url)`, e os blocos
 * interativos `<box>`/`<select>`/`<form>` (ver ../../../docs/formato-interativo-chat.md na raiz do monorepo —
 * gramática completa, protocolo de resposta, streaming, degradação por canal). client/ nunca importa nada de
 * backend-v2/ nem de web-app/ (pacotes TS totalmente separados) — qualquer mudança de gramática num lado
 * precisa ser espelhada no outro.
 *
 * Aqui vira a base pra `markdown-format.ts` (Telegram HTML, WhatsApp texto) e `render-markdown.ts`
 * (ANSI/Ink) — "um parser, N renderers".
 */

export type InlineNode =
    | { kind: 'text'; text: string }
    | { kind: 'bold'; text: string }
    | { kind: 'italic'; text: string }
    | { kind: 'code'; text: string }
    | { kind: 'image'; alt: string; url: string }
    | { kind: 'link'; text: string; url: string };

export interface OptionNode {
    text: string;
    value: string;
}

/** Item dentro de `<form>` — input, select aninhado ou botão. Mesma forma de `select`/`button` de nível de bloco, só reusada aqui. */
export type FormItem =
    | { kind: 'input'; name: string; label: string; inputType: 'text' | 'number'; placeholder?: string }
    | { kind: 'select'; label: string; multiple: boolean; options: OptionNode[] }
    | { kind: 'button'; text: string };

export type Block =
    | { kind: 'heading'; level: 1 | 2 | 3; inline: InlineNode[] }
    | { kind: 'hr' }
    | { kind: 'list'; ordered: boolean; items: InlineNode[][] }
    | { kind: 'codeblock'; text: string }
    | { kind: 'paragraph'; inline: InlineNode[] }
    /** Container — `title` opcional, `content` é markdown normal (recursivo, pode ter select/form dentro). */
    | { kind: 'box'; title?: string; content: Block[] }
    /** Escolha avulsa (fora de `<form>`) — `label` é a pergunta, sempre obrigatório. */
    | { kind: 'select'; label: string; multiple: boolean; options: OptionNode[] }
    /** `label` opcional (título do form — cada campo já tem o próprio label). */
    | { kind: 'form'; label?: string; items: FormItem[] }
    /** Botão avulso (fora de `<form>`) — clicar nele envia o próprio texto como resposta, sem prefixo. */
    | { kind: 'button'; text: string };

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
        if (index > lastIndex) nodes.push({ kind: 'text', text: text.slice(lastIndex, index) });

        const [full, imgAlt, imgUrl, linkText, linkUrl, bold, italic, code] = match;
        if (imgUrl !== undefined) nodes.push({ kind: 'image', alt: imgAlt ?? '', url: imgUrl });
        else if (linkUrl !== undefined) nodes.push({ kind: 'link', text: linkText || linkUrl, url: linkUrl });
        else if (bold !== undefined) nodes.push({ kind: 'bold', text: bold });
        else if (italic !== undefined) nodes.push({ kind: 'italic', text: italic });
        else if (code !== undefined) nodes.push({ kind: 'code', text: code });

        lastIndex = index + full.length;
    }
    if (lastIndex < text.length) nodes.push({ kind: 'text', text: text.slice(lastIndex) });
    return nodes.length ? nodes : [{ kind: 'text', text }];
}

const HEADING = /^(#{1,3})\s+(.+)$/;
const HR = /^(?:-{3,}|\*{3,}|_{3,})$/;
const UL_ITEM = /^[-*]\s+(.+)$/;
const OL_ITEM = /^\d+\.\s+(.+)$/;
const CODE_FENCE = /^```/;

// --- Blocos interativos (docs/formato-interativo-chat.md) — cada elemento cabe numa linha (abre+conteúdo+
// fecha), exceto box/select/form que abrem numa linha e fecham em outra. Atributos sempre `chave="valor"`
// entre aspas duplas — outro formato não casa e o bloco vira texto literal (nunca lança).
const BOX_OPEN = /^<box([^>]*)>$/;
const BOX_CLOSE = /^<\/box>$/;
const SELECT_OPEN = /^<select([^>]*)>$/;
const SELECT_CLOSE = /^<\/select>$/;
const FORM_OPEN = /^<form([^>]*)>$/;
const FORM_CLOSE = /^<\/form>$/;
const OPTION_LINE = /^<option([^>]*)>(.*)<\/option>$/;
const BUTTON_LINE = /^<button([^>]*)>(.*)<\/button>$/;
const INPUT_LINE = /^<input\s+([^>]*?)\s*\/?>$/;

function parseAttrs(tagAttrs: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const m of tagAttrs.matchAll(/(\w+)="([^"]*)"/g)) attrs[m[1]!] = m[2]!;
    return attrs;
}

function parseOptions(lines: string[], start: number): { options: OptionNode[]; end: number } | null {
    const options: OptionNode[] = [];
    for (let i = start; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (SELECT_CLOSE.test(line)) return options.length ? { options, end: i } : null;
        const m = OPTION_LINE.exec(line);
        if (!m) return null;
        const attrs = parseAttrs(m[1]!);
        const text = m[2]!;
        options.push({ text, value: attrs.value ?? text });
    }
    return null; // nunca fechou
}

function parseFormItems(lines: string[], start: number): { items: FormItem[]; end: number } | null {
    const items: FormItem[] = [];
    for (let i = start; i < lines.length; i++) {
        const line = lines[i]!.trim();
        if (FORM_CLOSE.test(line)) return items.some((it) => it.kind === 'button') ? { items, end: i } : null;

        const inputM = INPUT_LINE.exec(line);
        if (inputM) {
            const attrs = parseAttrs(inputM[1]!);
            if (!attrs.name || !attrs.label) return null;
            items.push({ kind: 'input', name: attrs.name, label: attrs.label, inputType: attrs.type === 'number' ? 'number' : 'text', placeholder: attrs.placeholder });
            continue;
        }

        const buttonM = BUTTON_LINE.exec(line);
        if (buttonM) {
            items.push({ kind: 'button', text: buttonM[2]! });
            continue;
        }

        const selectM = SELECT_OPEN.exec(line);
        if (selectM) {
            const attrs = parseAttrs(selectM[1]!);
            if (!attrs.label) return null;
            const body = parseOptions(lines, i + 1);
            if (!body) return null;
            items.push({ kind: 'select', label: attrs.label, multiple: attrs.multiple === 'true', options: body.options });
            i = body.end;
            continue;
        }

        return null; // linha não reconhecida dentro do form
    }
    return null; // nunca fechou
}

/** Tenta reconhecer `<box>`/`<select>`/`<form>`/`<button>` avulso a partir da linha `lines[i]` (já sabida começar com "<"). `null` = malformado, cai pra texto literal (chamador não faz nada especial, deixa a linha seguir o fluxo normal de parágrafo). */
function tryParseTagBlock(lines: string[], i: number): { block: Block; end: number } | null {
    const line = lines[i]!.trim();

    const boxM = BOX_OPEN.exec(line);
    if (boxM) {
        const attrs = parseAttrs(boxM[1]!);
        const contentLines: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
            if (BOX_CLOSE.test(lines[j]!.trim())) {
                return { block: { kind: 'box', title: attrs.title, content: parseBlocks(contentLines.join('\n')) }, end: j };
            }
            contentLines.push(lines[j]!);
        }
        return null;
    }

    const selectM = SELECT_OPEN.exec(line);
    if (selectM) {
        const attrs = parseAttrs(selectM[1]!);
        if (!attrs.label) return null;
        const body = parseOptions(lines, i + 1);
        if (!body) return null;
        return { block: { kind: 'select', label: attrs.label, multiple: attrs.multiple === 'true', options: body.options }, end: body.end };
    }

    const formM = FORM_OPEN.exec(line);
    if (formM) {
        const attrs = parseAttrs(formM[1]!);
        const body = parseFormItems(lines, i + 1);
        if (!body) return null;
        return { block: { kind: 'form', label: attrs.label, items: body.items }, end: body.end };
    }

    const buttonM = BUTTON_LINE.exec(line);
    if (buttonM) return { block: { kind: 'button', text: buttonM[2]! }, end: i };

    return null;
}

export function parseBlocks(text: string): Block[] {
    const lines = text.split('\n');
    const blocks: Block[] = [];

    let paragraphLines: string[] = [];
    let listItems: string[] = [];
    let listOrdered = false;

    const flushParagraph = () => {
        if (paragraphLines.length) {
            blocks.push({ kind: 'paragraph', inline: parseInline(paragraphLines.join('\n')) });
            paragraphLines = [];
        }
    };
    const flushList = () => {
        if (listItems.length) {
            blocks.push({ kind: 'list', ordered: listOrdered, items: listItems.map((line) => parseInline(line)) });
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
            blocks.push({ kind: 'codeblock', text: codeLines.join('\n') });
            continue;
        }

        if (!line) {
            flushParagraph();
            flushList();
            continue;
        }

        // Blocos interativos — só tentados fora de code fence (já tratado acima) e só quando a linha começa
        // com uma dessas tags; malformado cai pro fluxo normal (linha vira parágrafo, igual texto puro).
        if (line.startsWith('<box') || line.startsWith('<select') || line.startsWith('<form') || line.startsWith('<button')) {
            const tag = tryParseTagBlock(lines, i);
            if (tag) {
                flushParagraph();
                flushList();
                blocks.push(tag.block);
                i = tag.end;
                continue;
            }
        }

        const heading = HEADING.exec(line);
        if (heading) {
            flushParagraph();
            flushList();
            blocks.push({ kind: 'heading', level: heading[1].length as 1 | 2 | 3, inline: parseInline(heading[2]) });
            continue;
        }

        if (HR.test(line)) {
            flushParagraph();
            flushList();
            blocks.push({ kind: 'hr' });
            continue;
        }

        const ul = UL_ITEM.exec(line);
        if (ul) {
            flushParagraph();
            if (listItems.length && listOrdered) flushList();
            listOrdered = false;
            listItems.push(ul[1]);
            continue;
        }

        const ol = OL_ITEM.exec(line);
        if (ol) {
            flushParagraph();
            if (listItems.length && !listOrdered) flushList();
            listOrdered = true;
            listItems.push(ol[1]);
            continue;
        }

        flushList();
        paragraphLines.push(rawLine);
    }
    flushParagraph();
    flushList();

    return blocks;
}

const OPEN_TAG_LINE = /^<(box|select|form)\b/;
/** Fecham na MESMA linha (`<tag>texto</tag>`) — diferente de box/select/form, que abrem numa linha e fecham bem depois. */
const LEAF_TAGS = ['option', 'button'] as const;
const BLOCK_OPEN_TAGS = ['box', 'select', 'form'] as const;

/** A ÚLTIMA linha do buffer parece o começo de uma tag conhecida mas ainda não terminou de ser digitada. */
function looksUnfinished(line: string): boolean {
    if (!line.startsWith('<')) return false;
    for (const tag of LEAF_TAGS) if (line.startsWith(`<${tag}`)) return !line.endsWith(`</${tag}>`);
    if (line.startsWith('<input')) return !line.endsWith('/>') && !line.endsWith('>');
    for (const tag of BLOCK_OPEN_TAGS) if (line.startsWith(`<${tag}`)) return !line.endsWith('>');
    return false; // "<" solto que não bate com tag nenhuma conhecida — texto normal, não esconde.
}

/**
 * Só durante STREAMING (texto ainda chegando aos pedaços via `text_delta`) — nunca no texto final. Esconde
 * qualquer bloco interativo aberto sem fechamento correspondente AINDA no buffer, pra nunca mostrar
 * `<select label=` ou `<button>Confi` pela metade (docs/formato-interativo-chat.md §3). Os dois clientes
 * (TUI e web) chamam isto sobre o RASCUNHO em streaming antes de `parseBlocks`/renderizar — nunca sobre o
 * texto de uma mensagem já finalizada.
 */
export function hideIncompleteTag(text: string): string {
    const lines = text.split('\n');

    // 1) Última linha ainda sendo digitada (não terminou nem a PRÓPRIA sintaxe) — remove ela inteira.
    if (looksUnfinished(lines[lines.length - 1]!.trim())) lines.pop();

    // 2) Bloco de várias linhas (<box>/<select>/<form>) já abriu (linha 1 terminada) mas ainda não fechou em
    //    nenhum lugar do que sobrou — corta tudo a partir da linha de abertura.
    for (let i = 0; i < lines.length; i++) {
        const m = OPEN_TAG_LINE.exec(lines[i]!.trim());
        if (!m) continue;
        const closeTag = `</${m[1]}>`;
        if (!lines.slice(i + 1).some((l) => l.trim() === closeTag)) {
            lines.length = i;
            break;
        }
    }

    // Sem linha em branco sobrando no fim (o bloco cortado deixaria um "\n" solto atrás).
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
}
