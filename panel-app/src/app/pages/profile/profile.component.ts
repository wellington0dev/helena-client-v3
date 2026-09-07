import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { AuthService } from "../../core/auth.service";
import { McpConnectionsService } from "../../core/mcp-connections.service";
import type { ApiTokenSummary, UsageSummary } from "../../core/profile.service";
import { ProfileService } from "../../core/profile.service";
import { IconComponent } from "../../shared/icon.component";

type Channel = "whatsapp" | "telegram";

interface OwnerRow {
    key: Channel;
    label: string;
    linked: boolean;
    value?: string;
    editing: boolean;
    empty: boolean;
}

interface UsageBar {
    heightPct: number;
    title: string;
}
interface ChannelBar {
    label: string;
    value: number;
    widthPct: number;
}

const CHANNEL_LABELS: Record<string, string> = { panel: "Painel", whatsapp: "WhatsApp", telegram: "Telegram", cli: "CLI" };

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
function dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
}
function dayLabel(key: string): string {
    const d = new Date(`${key}T00:00:00Z`);
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

/** Identidade, telemetria, vínculo de canais, tokens de API e uso (30 dias) — tudo do próprio usuário logado. */
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

    protected readonly apiTokens = signal<ApiTokenSummary[]>([]);
    protected readonly apiTokensLoaded = signal(false);
    protected readonly newTokenValue = signal("");

    protected readonly usage = signal<UsageSummary | null>(null);

    /** Só pra alimentar `hasEnabledMcpConnection` — ver aviso no card de "Sempre permitir comandos". */
    private readonly hasEnabledMcp = signal(false);
    protected readonly showAutoApproveMcpWarning = computed(() => !!this.auth.currentUser()?.autoApproveShell && this.hasEnabledMcp());

    protected readonly ownerEditing = signal<Record<Channel, boolean>>({ whatsapp: false, telegram: false });
    protected readonly ownerDraft = signal<Record<Channel, string>>({ whatsapp: "", telegram: "" });

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
        return [
            { key: "whatsapp", label: "WhatsApp", linked: !!user?.whatsappOwnerNumber, value: user?.whatsappOwnerNumber, editing: editing.whatsapp, empty: !user?.whatsappOwnerNumber && !editing.whatsapp },
            { key: "telegram", label: "Telegram", linked: !!user?.telegramOwnerId, value: user?.telegramOwnerId, editing: editing.telegram, empty: !user?.telegramOwnerId && !editing.telegram },
        ];
    });

    protected readonly tokensEmpty = computed(() => this.apiTokensLoaded() && this.apiTokens().length === 0);

    protected readonly usageSummaryLabel = computed(() => {
        const usage = this.usage();
        if (!usage) return "carregando…";
        return `${usage.totalCalls} chamadas · primeira em ${fmtDate(usage.firstCallAt)} · última em ${fmtWhen(usage.lastCallAt)}`;
    });

    protected readonly usageBars = computed<UsageBar[]>(() => {
        const usage = this.usage();
        const byDate = new Map((usage?.callsByDay ?? []).map((d) => [d.date.slice(0, 10), d.calls]));
        const today = new Date();
        const last30 = Array.from({ length: 30 }, (_, i) => {
            const d = new Date(today.getTime() - (29 - i) * 86400000);
            const key = dayKey(d);
            return { date: key, calls: byDate.get(key) ?? 0 };
        });
        const max = Math.max(...last30.map((d) => d.calls), 1);
        return last30.map((d) => ({ heightPct: Math.max(3, Math.round((d.calls / max) * 100)), title: `${dayLabel(d.date)}: ${d.calls}` }));
    });

    protected readonly channelBars = computed<ChannelBar[]>(() => {
        const usage = this.usage();
        const byChannel = usage?.callsByChannel ?? {};
        const max = Math.max(...Object.values(byChannel), 1);
        return Object.entries(byChannel).map(([k, v]) => ({ label: CHANNEL_LABELS[k] ?? k, value: v, widthPct: Math.round((v / max) * 100) }));
    });

    constructor() {
        void this.profile.listApiTokens().then((tokens) => {
            this.apiTokens.set(tokens);
            this.apiTokensLoaded.set(true);
        });
        void this.profile.usage().then((usage) => this.usage.set(usage));
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

    startLinkOwner(ch: Channel): void {
        this.ownerEditing.update((s) => ({ ...s, [ch]: true }));
        this.ownerDraft.update((s) => ({ ...s, [ch]: "" }));
    }

    setOwnerDraft(ch: Channel, value: string): void {
        this.ownerDraft.update((s) => ({ ...s, [ch]: value.replace(/\D/g, "") }));
    }

    async saveOwnerLink(ch: Channel): Promise<void> {
        const contactId = this.ownerDraft()[ch];
        if (!contactId) return;
        await this.auth.setOwnerIdentity(ch, contactId);
        this.ownerEditing.update((s) => ({ ...s, [ch]: false }));
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
}
