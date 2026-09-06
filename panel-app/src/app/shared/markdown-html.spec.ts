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

    it("caminho relativo (/data-files/...) cru vira link ABSOLUTO (resolvido contra apiBaseUrl, não a origem do painel)", () => {
        const html = renderMessageHtml("Link: /data-files/abc123/download?token=xyz", BASE);
        expect(html).toContain(`href="${BASE}/data-files/abc123/download?token=xyz"`);
    });

    it("link markdown com caminho relativo também resolve contra apiBaseUrl", () => {
        const html = renderMessageHtml("[arquivo.csv](/data-files/abc123/download?token=xyz)", BASE);
        expect(html).toContain(`href="${BASE}/data-files/abc123/download?token=xyz"`);
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
