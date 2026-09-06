import { type Block, type InlineNode, parseBlocks } from "./markdown";

/**
 * Link/caminho CRU que o modelo às vezes cola direto na resposta (sem
 * sintaxe markdown `[texto](url)`) — ex: o link de download de
 * standardize_data. Sem isto, essas URLs ficam como texto morto na bolha
 * (bug real reportado: link de download aparecia como texto puro, não
 * clicável). Lookbehind evita linkificar de novo a URL que já está DENTRO
 * de um `[texto](URL)` genuíno (a URL sempre vem logo depois de "](").
 */
const BARE_URL_PATTERN = /(?<!\]\()(https?:\/\/[^\s)]+|\/data-files\/[^\s)]+)/g;

function linkifyBareUrls(text: string): string {
    return text.replace(BARE_URL_PATTERN, (url) => `[${url}](${url})`);
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** `/data-files/...` (relativo, emitido pelas tools) precisa virar absoluto pro backend-v2 — um `<a href>` de verdade é navegação de NAVEGADOR, não passa pelo authInterceptor do Angular (esse só intercepta chamada feita via HttpClient). */
function resolveUrl(url: string, apiBaseUrl: string): string {
    return url.startsWith("/") ? `${apiBaseUrl}${url}` : url;
}

/** Nunca renderiza `javascript:`/outro esquema estranho, mesmo que o texto tenha vindo só do próprio modelo (defesa em profundidade — a resposta pode ecoar algo que leu de uma nota/contato). */
function isSafeUrl(url: string): boolean {
    return /^https?:\/\//.test(url) || url.startsWith("/");
}

/** Reconhece um link de download do backend-v2 (POST /data-files/upload, analyze_data/standardize_data) — vira um preview-card em vez de um <a> pelado. Casa a URL crua (relativa ou absoluta, tanto faz — o path é o mesmo nos dois casos). */
const DATA_FILE_LINK_PATTERN = /\/data-files\/([^/?]+)\/download(?:\?|$)/;

function matchDataFileId(url: string): string | undefined {
    return DATA_FILE_LINK_PATTERN.exec(url)?.[1];
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

/** Só o BACKEND sabe o mimeType de verdade — o renderer infere pela extensão do nome (texto do link) porque é tudo que tem disponível aqui; por isso as tools são instruídas a sempre usar o filename real como texto do link (ver data-files.tools.ts). */
function kindFromLinkText(text: string): "image" | "csv" | "xlsx" | "file" {
    const ext = text.toLowerCase().split(".").pop() ?? "";
    if (IMAGE_EXTENSIONS.has(ext)) return "image";
    if (ext === "xlsx") return "xlsx";
    if (ext === "csv") return "csv";
    return "file";
}

function renderFilePreviewCard(fileId: string, kind: string, downloadUrl: string, filename: string): string {
    const url = escapeHtml(downloadUrl);
    const name = escapeHtml(filename);
    const body = kind === "image" ? `<img src="${url}" alt="${name}" class="file-preview-thumb" />` : `<span class="file-preview-icon">${kind === "xlsx" ? "📊" : "📄"}</span><span class="file-preview-name">${name}</span>`;
    return `<div class="file-preview-card" data-file-id="${escapeHtml(fileId)}" data-kind="${escapeHtml(kind)}" data-download-url="${url}" data-filename="${name}">${body}</div>`;
}

function renderInlineNode(node: InlineNode, apiBaseUrl: string): string {
    switch (node.kind) {
        case "text":
            return escapeHtml(node.text);
        case "bold":
            return `<strong>${escapeHtml(node.text)}</strong>`;
        case "italic":
            return `<em>${escapeHtml(node.text)}</em>`;
        case "code":
            return `<code>${escapeHtml(node.text)}</code>`;
        case "link": {
            if (!isSafeUrl(node.url)) return escapeHtml(node.text);
            const href = resolveUrl(node.url, apiBaseUrl);
            const fileId = matchDataFileId(node.url);
            if (fileId) return renderFilePreviewCard(fileId, kindFromLinkText(node.text), href, node.text);
            return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(node.text)}</a>`;
        }
        case "image": {
            if (!isSafeUrl(node.url)) return escapeHtml(node.alt);
            const src = resolveUrl(node.url, apiBaseUrl);
            return `<img src="${escapeHtml(src)}" alt="${escapeHtml(node.alt)}" class="message-image" />`;
        }
    }
}

function renderInline(nodes: InlineNode[], apiBaseUrl: string): string {
    return nodes.map((node) => renderInlineNode(node, apiBaseUrl)).join("");
}

function renderBlock(block: Block, apiBaseUrl: string): string {
    switch (block.kind) {
        case "heading":
            return `<h${block.level}>${renderInline(block.inline, apiBaseUrl)}</h${block.level}>`;
        case "hr":
            return "<hr />";
        case "list": {
            const tag = block.ordered ? "ol" : "ul";
            const items = block.items.map((item) => `<li>${renderInline(item, apiBaseUrl)}</li>`).join("");
            return `<${tag}>${items}</${tag}>`;
        }
        case "codeblock":
            return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
        case "paragraph":
            return `<p>${renderInline(block.inline, apiBaseUrl)}</p>`;
    }
}

/** Único ponto de entrada — texto cru da mensagem (do modelo) → HTML seguro pra `[innerHTML]` (sempre via DomSanitizer.bypassSecurityTrustHtml no componente, nunca direto). */
export function renderMessageHtml(text: string, apiBaseUrl: string): string {
    return parseBlocks(linkifyBareUrls(text))
        .map((block) => renderBlock(block, apiBaseUrl))
        .join("");
}
