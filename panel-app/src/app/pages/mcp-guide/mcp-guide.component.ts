import { Component, computed, inject } from "@angular/core";
import { DomSanitizer, type SafeHtml } from "@angular/platform-browser";
import { API_BASE_URL } from "../../core/api-base.token";
import { AuthService } from "../../core/auth.service";
import { renderMessageHtml } from "../../shared/markdown-html";
import { buildMcpGuideMarkdown } from "./mcp-guide-content";

/** Guia de como um terceiro constrói um servidor MCP compatível e conecta na Helena — conteúdo estático (adaptado de backend-v2/docs/mcp-server-guide.md), renderizado com o mesmo parser de markdown das bolhas do chat. */
@Component({
    selector: "app-mcp-guide",
    templateUrl: "./mcp-guide.component.html",
    styleUrl: "./mcp-guide.component.css",
})
export class McpGuideComponent {
    private readonly sanitizer = inject(DomSanitizer);
    private readonly apiBaseUrl = inject(API_BASE_URL);
    private readonly auth = inject(AuthService);

    protected readonly html = computed<SafeHtml>(() => {
        const markdown = buildMcpGuideMarkdown(this.apiBaseUrl, this.auth.token() ?? "");
        return this.sanitizer.bypassSecurityTrustHtml(renderMessageHtml(markdown, this.apiBaseUrl));
    });
}
