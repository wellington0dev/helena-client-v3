import { Component, computed, inject, signal } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { ChatUiStateService } from "../core/chat-ui-state.service";
import { AuthService } from "../core/auth.service";
import { ThemeService } from "../core/theme.service";
import { IconComponent } from "../shared/icon.component";
import { ToastContainerComponent } from "../shared/toast-container.component";

interface NavItem {
    path: string;
    label: string;
    icon: string;
}

/** Sidebar fixa (logo, navegação, conversas, conta) + <router-outlet> pras páginas internas — layout compartilhado, ver app.routes.ts. */
@Component({
    selector: "app-shell",
    imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent, ToastContainerComponent],
    templateUrl: "./app-shell.component.html",
    styleUrl: "./app-shell.component.css",
})
export class AppShellComponent {
    protected readonly auth = inject(AuthService);
    protected readonly theme = inject(ThemeService);
    protected readonly chatUi = inject(ChatUiStateService);

    protected readonly navItems: NavItem[] = [
        { path: "/chat", label: "Chat", icon: "chat" },
        { path: "/projetos", label: "Projetos", icon: "layers" },
        { path: "/canais", label: "Canais", icon: "channels" },
        { path: "/contatos", label: "Contatos", icon: "contacts" },
        { path: "/integracoes", label: "Conexões MCP", icon: "plug" },
        { path: "/perfil", label: "Perfil", icon: "profile" },
        { path: "/cobranca", label: "Créditos", icon: "billing" },
        { path: "/uso", label: "Uso", icon: "chart" },
    ];

    /** Sidebar vira um drawer off-canvas abaixo do breakpoint mobile (ver app-shell.component.css) — fechado por padrão, mesmo se a pessoa girar a tela ou navegar; nunca persiste entre sessões, é só estado de UI momentâneo. */
    protected readonly sidebarOpen = signal(false);

    /** Modo "só ícone" da sidebar no desktop — não persiste, é só estado de UI momentâneo (ver toggleSidebarCollapsed). */
    protected readonly sidebarCollapsed = signal(false);

    protected readonly me = computed(() => {
        const user = this.auth.currentUser();
        if (!user) return { initial: "", name: "", email: "" };
        const name = user.displayName || user.email;
        return { initial: name.charAt(0).toUpperCase(), name, email: user.email };
    });

    constructor() {
        void this.chatUi.ensureLoaded();
    }

    selectSession(id: string): void {
        this.chatUi.selectSession(id);
        this.closeSidebar();
    }

    toggleSidebar(): void {
        this.sidebarOpen.update((open) => !open);
    }

    closeSidebar(): void {
        this.sidebarOpen.set(false);
    }

    toggleSidebarCollapsed(): void {
        this.sidebarCollapsed.update((collapsed) => !collapsed);
    }

    fmtWhen(iso: string): string {
        const diffH = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
        if (diffH < 1) return "agora";
        if (diffH < 24) return `${diffH}h atrás`;
        return `${Math.round(diffH / 24)}d atrás`;
    }
}
