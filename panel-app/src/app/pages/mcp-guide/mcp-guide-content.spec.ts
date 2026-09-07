import { describe, expect, it } from "vitest";
import { renderMessageHtml } from "../../shared/markdown-html";
import { buildMcpGuideMarkdown } from "./mcp-guide-content";

const BASE = "http://localhost:4001";

describe("buildMcpGuideMarkdown + renderMessageHtml (guia de MCP no painel)", () => {
    it("interpola a URL do backend e o token nos exemplos de curl", () => {
        const markdown = buildMcpGuideMarkdown(BASE, "meu-jwt-de-teste");
        expect(markdown).toContain(`curl -X POST ${BASE}/mcp-connections`);
        expect(markdown).toContain("Authorization: Bearer meu-jwt-de-teste");
    });

    it("sem token (deslogado), mantém instrução de fazer login em vez de quebrar o exemplo", () => {
        const markdown = buildMcpGuideMarkdown(BASE, "");
        expect(markdown).toContain("Faça login pra ver seu token");
    });

    it("renderiza sem sobrar sintaxe markdown crua (## / ``` / **) no HTML final", () => {
        const html = renderMessageHtml(buildMcpGuideMarkdown(BASE, "token-x"), BASE);
        expect(html).not.toContain("##");
        expect(html).not.toContain("```");
        expect(html).not.toMatch(/\*\*[^*]/); // negrito cru sobrando (permite ** dentro de código, que não deveria casar aqui)
    });

    it("todas as 6 seções numeradas viram <h2>", () => {
        const html = renderMessageHtml(buildMcpGuideMarkdown(BASE, "token-x"), BASE);
        for (const n of [1, 2, 3, 4, 5, 6]) {
            expect(html).toMatch(new RegExp(`<h2>${n}\\.`));
        }
    });

    it("o exemplo de servidor mínimo vira um bloco <pre><code>, não texto solto", () => {
        const html = renderMessageHtml(buildMcpGuideMarkdown(BASE, "token-x"), BASE);
        expect(html).toContain("<pre><code>");
        expect(html).toContain("StreamableHTTPServerTransport");
    });
});
