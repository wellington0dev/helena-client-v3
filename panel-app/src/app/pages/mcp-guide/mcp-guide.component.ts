import { HttpErrorResponse } from "@angular/common/http";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DomSanitizer, type SafeHtml } from "@angular/platform-browser";
import { RouterLink } from "@angular/router";
import { API_BASE_URL } from "../../core/api-base.token";
import { AuthService } from "../../core/auth.service";
import type { CreateMcpConnectionInput, McpConnectionSummary } from "../../core/mcp-connections.service";
import { McpConnectionsService } from "../../core/mcp-connections.service";
import { IconComponent } from "../../shared/icon.component";
import { renderMessageHtml } from "../../shared/markdown-html";
import { buildMcpGuideMarkdown } from "./mcp-guide-content";

interface ConnectionForm {
    id?: string; // presente = editando; ausente = nova conexão.
    name: string;
    serverUrl: string;
    authToken: string;
    enabled: boolean;
}

const EMPTY_FORM: ConnectionForm = { name: "", serverUrl: "", authToken: "", enabled: true };

function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && typeof err.error?.message === "string") return err.error.message;
    return err instanceof Error ? err.message : fallback;
}

/**
 * Página "Integrações": formulário de gerenciar conexões MCP (CRUD contra
 * /mcp-connections) + o guia de como construir um servidor MCP compatível
 * (conteúdo estático, adaptado de backend-v2/docs/mcp-server-guide.md,
 * renderizado com o mesmo parser de markdown das bolhas do chat).
 */
@Component({
    selector: "app-mcp-guide",
    imports: [FormsModule, IconComponent, RouterLink],
    templateUrl: "./mcp-guide.component.html",
    styleUrl: "./mcp-guide.component.css",
})
export class McpGuideComponent {
    private readonly sanitizer = inject(DomSanitizer);
    private readonly apiBaseUrl = inject(API_BASE_URL);
    private readonly auth = inject(AuthService);
    private readonly connections = inject(McpConnectionsService);

    protected readonly list = signal<McpConnectionSummary[]>([]);
    protected readonly loaded = signal(false);
    protected readonly error = signal("");
    protected readonly saving = signal(false);

    /** `null` = formulário fechado. */
    protected readonly form = signal<ConnectionForm | null>(null);
    protected readonly isEditing = computed(() => !!this.form()?.id);

    /** Ver aviso equivalente em profile.component.ts — mesmo risco, mostrado no outro lado da combinação (aqui: "você já tem auto-approve ligado, cuidado com o que conecta"). */
    protected readonly showAutoApproveWarning = computed(() => !!this.auth.currentUser()?.autoApproveShell);

    protected readonly html = computed<SafeHtml>(() => {
        const markdown = buildMcpGuideMarkdown(this.apiBaseUrl, this.auth.token() ?? "");
        return this.sanitizer.bypassSecurityTrustHtml(renderMessageHtml(markdown, this.apiBaseUrl));
    });

    constructor() {
        void this.reload();
    }

    private async reload(): Promise<void> {
        try {
            this.list.set(await this.connections.list());
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Falha ao carregar as conexões."));
        } finally {
            this.loaded.set(true);
        }
    }

    openCreateForm(): void {
        this.error.set("");
        this.form.set({ ...EMPTY_FORM });
    }

    openEditForm(connection: McpConnectionSummary): void {
        this.error.set("");
        this.form.set({ id: connection.id, name: connection.name, serverUrl: connection.serverUrl, authToken: "", enabled: connection.enabled });
    }

    closeForm(): void {
        this.form.set(null);
    }

    updateForm(patch: Partial<ConnectionForm>): void {
        const current = this.form();
        if (current) this.form.set({ ...current, ...patch });
    }

    async save(): Promise<void> {
        const current = this.form();
        if (!current || !current.name.trim() || !current.serverUrl.trim()) return;

        this.saving.set(true);
        this.error.set("");
        try {
            if (current.id) {
                const updated = await this.connections.update(current.id, {
                    name: current.name.trim(),
                    serverUrl: current.serverUrl.trim(),
                    enabled: current.enabled,
                    ...(current.authToken.trim() && { authToken: current.authToken.trim() }),
                });
                this.list.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
            } else {
                const input: CreateMcpConnectionInput = { name: current.name.trim(), serverUrl: current.serverUrl.trim(), enabled: current.enabled };
                if (current.authToken.trim()) input.authToken = current.authToken.trim();
                const created = await this.connections.create(input);
                this.list.update((rows) => [...rows, created]);
            }
            this.form.set(null);
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Falha ao salvar a conexão."));
        } finally {
            this.saving.set(false);
        }
    }

    /** Liga/desliga direto na lista, sem abrir o formulário — otimista, mesmo padrão de revokeToken em profile.component.ts. */
    async toggleEnabled(connection: McpConnectionSummary): Promise<void> {
        const prev = this.list();
        this.list.update((rows) => rows.map((row) => (row.id === connection.id ? { ...row, enabled: !row.enabled } : row)));
        try {
            await this.connections.update(connection.id, { enabled: !connection.enabled });
        } catch (err) {
            this.list.set(prev);
            this.error.set(extractErrorMessage(err, "Falha ao atualizar a conexão."));
        }
    }

    async remove(connection: McpConnectionSummary): Promise<void> {
        const prev = this.list();
        this.list.update((rows) => rows.filter((row) => row.id !== connection.id));
        try {
            await this.connections.delete(connection.id);
        } catch (err) {
            this.list.set(prev);
            this.error.set(extractErrorMessage(err, "Falha ao remover a conexão."));
        }
    }
}
