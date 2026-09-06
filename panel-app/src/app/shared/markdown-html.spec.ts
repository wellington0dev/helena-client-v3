import { describe, expect, it } from "vitest";
import { renderMessageHtml } from "./markdown-html";

const BASE = "http://localhost:4001";

describe("renderMessageHtml", () => {
    it("negrito/itálico/código viram tags HTML", () => {
        expect(renderMessageHtml("**forte** e *itálico* e `codigo`", BASE)).toBe("<p><strong>forte</strong> e <em>itálico</em> e <code>codigo</code></p>");
    });

    it("link markdown [texto](url) vira <a> clicável com target/rel seguros", () => {
        const html = renderMessageHtml("[baixe aqui](https://exemplo.com/x)", BASE);
        expect(html).toContain('href="https://exemplo.com/x"');
        expect(html).toContain('target="_blank"');
        expect(html).toContain('rel="noopener noreferrer"');
        expect(html).toContain(">baixe aqui</a>");
    });

    it("bug real: link CRU (sem sintaxe markdown) vira clicável mesmo assim", () => {
        const html = renderMessageHtml("Baixe aqui: https://exemplo.com/arquivo.csv", BASE);
        expect(html).toContain('<a href="https://exemplo.com/arquivo.csv"');
    });

    it("link pra /data-files/.../download vira um preview-card, não um <a> pelado — data-download-url resolvido contra apiBaseUrl", () => {
        const html = renderMessageHtml("[relatorio.csv](/data-files/abc123/download?token=xyz)", BASE);
        expect(html).not.toContain("<a ");
        expect(html).toContain('class="file-preview-card"');
        expect(html).toContain('data-file-id="abc123"');
        expect(html).toContain(`data-download-url="${BASE}/data-files/abc123/download?token=xyz"`);
    });

    it("link CRU (sem markdown) pra /data-files/.../download também vira card (via auto-linkify + detecção)", () => {
        const html = renderMessageHtml("Link: /data-files/abc123/download?token=xyz", BASE);
        expect(html).toContain('class="file-preview-card"');
    });

    it("kind do card vem da EXTENSÃO do texto do link: .csv/.xlsx viram ícone, imagem vira <img> thumbnail", () => {
        const csv = renderMessageHtml("[vendas.csv](/data-files/1/download?token=t)", BASE);
        expect(csv).toContain('data-kind="csv"');
        expect(csv).toContain("📄");

        const xlsx = renderMessageHtml("[vendas.xlsx](/data-files/2/download?token=t)", BASE);
        expect(xlsx).toContain('data-kind="xlsx"');
        expect(xlsx).toContain("📊");

        const image = renderMessageHtml("[foto.jpg](/data-files/3/download?token=t)", BASE);
        expect(image).toContain('data-kind="image"');
        expect(image).toContain('<img src="' + BASE + '/data-files/3/download?token=t"');
    });

    it("texto do link sem extensão reconhecida vira kind genérico 'file'", () => {
        const html = renderMessageHtml("[aqui](/data-files/4/download?token=t)", BASE);
        expect(html).toContain('data-kind="file"');
    });

    it("esquema perigoso (javascript:) nunca vira href — cai pro texto puro", () => {
        const html = renderMessageHtml("[clique](javascript:alert(1))", BASE);
        expect(html).not.toContain("<a ");
        expect(html).toContain("clique");
    });

    it("HTML no texto da pessoa/modelo é escapado, nunca interpretado", () => {
        const html = renderMessageHtml('<script>alert(1)</script> & "aspas"', BASE);
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("&amp;");
    });

    it("lista vira <ul>/<li>", () => {
        const html = renderMessageHtml("- item um\n- item dois", BASE);
        expect(html).toBe("<ul><li>item um</li><li>item dois</li></ul>");
    });

    it("bloco de código preserva conteúdo cru (não processa markdown dentro)", () => {
        const html = renderMessageHtml("```\n*não vira itálico*\n```", BASE);
        expect(html).toBe("<pre><code>*não vira itálico*</code></pre>");
    });
});
