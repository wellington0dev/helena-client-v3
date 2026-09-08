import { HttpClient } from "@angular/common/http";
import { Injectable, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { firstValueFrom } from "rxjs";

export type UserRole = "admin" | "user" | "tester";

export interface CurrentUser {
    id: string;
    email: string;
    displayName?: string;
    role: UserRole;
    telemetryConsent: boolean;
    autoApproveShell: boolean;
    allowProactiveMessages: boolean;
    whatsappOwnerNumber?: string;
    telegramOwnerId?: string;
    createdAt: string;
}

interface AuthResult {
    accessToken: string;
}

const TOKEN_KEY = "helena_client_token";

/** Mesma chave de localStorage que a página dc-runtime anterior usava — preserva sessão de quem já tinha logado antes da migração. */
@Injectable({ providedIn: "root" })
export class AuthService {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    readonly token = signal<string | null>(typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null);
    readonly currentUser = signal<CurrentUser | null>(null);
    readonly isAuthenticated = computed(() => this.token() !== null);

    async login(email: string, password: string): Promise<void> {
        const res = await firstValueFrom(this.http.post<AuthResult>("/auth/login", { email, password }));
        this.setToken(res.accessToken);
        await this.loadMe();
    }

    async register(email: string, password: string, displayName?: string): Promise<void> {
        const res = await firstValueFrom(this.http.post<AuthResult>("/auth/register", { email, password, displayName }));
        this.setToken(res.accessToken);
        await this.loadMe();
    }

    async loadMe(): Promise<CurrentUser> {
        const me = await firstValueFrom(this.http.get<CurrentUser>("/auth/me"));
        this.currentUser.set(me);
        return me;
    }

    /** Otimista — reverte se o PATCH falhar (mesmo padrão usado no painel admin). */
    async setTelemetryConsent(consent: boolean): Promise<void> {
        const prev = this.currentUser();
        if (prev) this.currentUser.set({ ...prev, telemetryConsent: consent });
        try {
            await firstValueFrom(this.http.patch<{ telemetryConsent: boolean }>("/auth/me/telemetry-consent", { consent }));
        } catch (err) {
            if (prev) this.currentUser.set(prev);
            throw err;
        }
    }

    /** Otimista, mesmo padrão de setTelemetryConsent — "sempre permitir" pra tool `shell` (ver machines.tools.ts no backend-v2). */
    async setAutoApproveShell(enabled: boolean): Promise<void> {
        const prev = this.currentUser();
        if (prev) this.currentUser.set({ ...prev, autoApproveShell: enabled });
        try {
            await firstValueFrom(this.http.patch<{ autoApproveShell: boolean }>("/auth/me/auto-approve-shell", { enabled }));
        } catch (err) {
            if (prev) this.currentUser.set(prev);
            throw err;
        }
    }

    /** Otimista, mesmo padrão de setAutoApproveShell — libera a tool message_contact (Helena falar por iniciativa própria, ver contacts.tools.ts no backend-v2). */
    async setAllowProactiveMessages(enabled: boolean): Promise<void> {
        const prev = this.currentUser();
        if (prev) this.currentUser.set({ ...prev, allowProactiveMessages: enabled });
        try {
            await firstValueFrom(this.http.patch<{ allowProactiveMessages: boolean }>("/auth/me/allow-proactive-messages", { enabled }));
        } catch (err) {
            if (prev) this.currentUser.set(prev);
            throw err;
        }
    }

    async setOwnerIdentity(channel: "whatsapp" | "telegram", contactId: string): Promise<void> {
        await firstValueFrom(this.http.patch("/auth/me/owner-identity", { channel, contactId }));
        await this.loadMe();
    }

    logout(): void {
        this.setToken(null);
        this.currentUser.set(null);
        this.router.navigateByUrl("/login");
    }

    private setToken(token: string | null): void {
        this.token.set(token);
        if (typeof localStorage === "undefined") return;
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    }
}
