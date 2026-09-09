import { HttpErrorResponse } from "@angular/common/http";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import type { FeedbackCategory } from "../../core/feedback.service";
import { FeedbackService } from "../../core/feedback.service";
import { McpConnectionsService } from "../../core/mcp-connections.service";
import type { ApiTokenSummary } from "../../core/profile.service";
import { ProfileService } from "../../core/profile.service";
import { IconComponent } from "../../shared/icon.component";

type Channel = "whatsapp" | "telegram";

function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && typeof err.error?.message === "string") return err.error.message;
    return err instanceof Error ? err.message : fallback;
}

interface OwnerRow {
    key: Channel;
    label: string;
    linked: boolean;
    value?: string;
    editing: boolean;
    empty: boolean;
    saving: boolean;
    error: string;
}

function pad(n: number): string {
    return n < 10 ? `0${n}` : `${n}`;
}
function fmtDate(iso?: string | null): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtWhen(iso?: string | null): string {
    if (!iso) return "—";
    const diffH = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
    if (diffH < 1) return "agora";
    if (diffH < 24) return `${diffH}h atrás`;
    return `${Math.round(diffH / 24)}d atrás`;
}
/** Identidade, telemetria, vínculo de canais e tokens de API — tudo do próprio usuário logado (uso/consumo agora tem página própria, ver pages/usage). */
@Component({
    selector: "app-profile",
    imports: [FormsModule, RouterLink, IconComponent],
    templateUrl: "./profile.component.html",
    styleUrl: "./profile.component.css",
})
export class ProfileComponent {
    protected readonly auth = inject(AuthService);
    private readonly profile = inject(ProfileService);
    private readonly mcpConnections = inject(McpConnectionsService);
    private readonly feedback = inject(FeedbackService);

    protected feedbackCategory: FeedbackCategory = "bug";
    protected feedbackMessage = "";
    protected readonly feedbackSaving = signal(false);
    protected readonly feedbackError = signal("");
    protected readonly feedbackSent = signal(false);

    protected readonly apiTokens = signal<ApiTokenSummary[]>([]);
    protected readonly apiTokensLoaded = signal(false);
    protected readonly newTokenValue = signal("");

    /** Só pra alimentar `hasEnabledMcpConnection` — ver aviso no card de "Sempre permitir comandos". */
    private readonly hasEnabledMcp = signal(false);
    protected readonly showAutoApproveMcpWarning = computed(() => !!this.auth.currentUser()?.autoApproveShell && this.hasEnabledMcp());

    protected readonly ownerEditing = signal<Record<Channel, boolean>>({ whatsapp: false, telegram: false });
    protected readonly ownerDraft = signal<Record<Channel, string>>({ whatsapp: "", telegram: "" });
    protected readonly ownerSaving = signal<Record<Channel, boolean>>({ whatsapp: false, telegram: false });
    protected readonly ownerError = signal<Record<Channel, string>>({ whatsapp: "", telegram: "" });

    protected readonly me = computed(() => {
        const user = this.auth.currentUser();
        if (!user) return { initial: "", name: "", email: "", roleLabel: "", createdAtLabel: "" };
        const name = user.displayName || user.email;
        const roleLabel = user.role === "admin" ? "Admin" : user.role === "tester" ? "Tester" : "Cliente";
        return { initial: name.charAt(0).toUpperCase(), name, email: user.email, roleLabel, createdAtLabel: fmtDate(user.createdAt) };
    });

    protected readonly ownerRows = computed<OwnerRow[]>(() => {
        const user = this.auth.currentUser();
        const editing = this.ownerEditing();
        const saving = this.ownerSaving();
        const error = this.ownerError();
        return [
            { key: "whatsapp", label: "WhatsApp", linked: !!user?.whatsappOwnerNumber, value: user?.whatsappOwnerNumber, editing: editing.whatsapp, empty: !user?.whatsappOwnerNumber && !editing.whatsapp, saving: saving.whatsapp, error: error.whatsapp },
            { key: "telegram", label: "Telegram", linked: !!user?.telegramOwnerId, value: user?.telegramOwnerId, editing: editing.telegram, empty: !user?.telegramOwnerId && !editing.telegram, saving: saving.telegram, error: error.telegram },
        ];
    });

    protected readonly tokensEmpty = computed(() => this.apiTokensLoaded() && this.apiTokens().length === 0);

    constructor() {
        void this.profile.listApiTokens().then((tokens) => {
            this.apiTokens.set(tokens);
            this.apiTokensLoaded.set(true);
        });
        void this.mcpConnections.list().then((connections) => this.hasEnabledMcp.set(connections.some((c) => c.enabled)));
    }

    fmtDate = fmtDate;
    fmtWhen = fmtWhen;

    async toggleTelemetry(): Promise<void> {
        const next = !this.auth.currentUser()?.telemetryConsent;
        await this.auth.setTelemetryConsent(next);
    }

    async toggleAutoApproveShell(): Promise<void> {
        const next = !this.auth.currentUser()?.autoApproveShell;
        await this.auth.setAutoApproveShell(next);
    }

    async toggleAllowProactiveMessages(): Promise<void> {
        const next = !this.auth.currentUser()?.allowProactiveMessages;
        await this.auth.setAllowProactiveMessages(next);
    }

    /** Serve tanto pra vincular (nada cadastrado ainda) quanto pra trocar (já linkado) — o draft parte do valor atual, pra editar em vez de sempre começar em branco. */
    startLinkOwner(ch: Channel): void {
        const user = this.auth.currentUser();
        const current = ch === "whatsapp" ? user?.whatsappOwnerNumber : user?.telegramOwnerId;
        this.ownerEditing.update((s) => ({ ...s, [ch]: true }));
        this.ownerDraft.update((s) => ({ ...s, [ch]: current ?? "" }));
        this.ownerError.update((s) => ({ ...s, [ch]: "" }));
    }

    cancelOwnerEdit(ch: Channel): void {
        this.ownerEditing.update((s) => ({ ...s, [ch]: false }));
        this.ownerError.update((s) => ({ ...s, [ch]: "" }));
    }

    setOwnerDraft(ch: Channel, value: string): void {
        this.ownerDraft.update((s) => ({ ...s, [ch]: value.replace(/\D/g, "") }));
    }

    /** Bug real corrigido: sem try/catch aqui, um erro do PATCH (ex: número já registrado por outro canal) falhava em silêncio — nenhuma mensagem, nada na tela, parecia que "não funciona" sem explicar por quê. */
    async saveOwnerLink(ch: Channel): Promise<void> {
        const contactId = this.ownerDraft()[ch];
        if (!contactId) return;

        this.ownerSaving.update((s) => ({ ...s, [ch]: true }));
        this.ownerError.update((s) => ({ ...s, [ch]: "" }));
        try {
            await this.auth.setOwnerIdentity(ch, contactId);
            this.ownerEditing.update((s) => ({ ...s, [ch]: false }));
        } catch (err) {
            this.ownerError.update((s) => ({ ...s, [ch]: extractErrorMessage(err, "Falha ao salvar — tente de novo.") }));
        } finally {
            this.ownerSaving.update((s) => ({ ...s, [ch]: false }));
        }
    }

    async createToken(): Promise<void> {
        const res = await this.profile.createApiToken();
        this.apiTokens.update((list) => [{ id: res.id, label: res.label, createdAt: res.createdAt, lastUsedAt: null }, ...list]);
        this.newTokenValue.set(res.token);
    }

    async revokeToken(id: string): Promise<void> {
        const prev = this.apiTokens();
        this.apiTokens.set(prev.filter((t) => t.id !== id));
        try {
            await this.profile.revokeApiToken(id);
        } catch {
            this.apiTokens.set(prev);
        }
    }

    setFeedbackCategory(category: FeedbackCategory): void {
        this.feedbackCategory = category;
        this.feedbackSent.set(false);
        this.feedbackError.set("");
    }

    async submitFeedback(): Promise<void> {
        const message = this.feedbackMessage.trim();
        if (!message) return;

        this.feedbackSaving.set(true);
        this.feedbackError.set("");
        try {
            await this.feedback.submit({ category: this.feedbackCategory, message });
            this.feedbackMessage = "";
            this.feedbackSent.set(true);
        } catch (err) {
            this.feedbackError.set(extractErrorMessage(err, "Não consegui enviar — tente de novo."));
        } finally {
            this.feedbackSaving.set(false);
        }
    }
}
