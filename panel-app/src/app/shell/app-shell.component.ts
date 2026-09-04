import { Component, computed, inject } from "@angular/core";
import { RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import { ChatUiStateService } from "../core/chat-ui-state.service";
import { AuthService } from "../core/auth.service";
import { ThemeService } from "../core/theme.service";
import { IconComponent } from "../shared/icon.component";

interface NavItem {
    path: string;
    label: string;
    icon: string;
}

/** Sidebar fixa (logo, navegação, conversas, conta) + <router-outlet> pras 4 páginas internas — layout compartilhado, ver app.routes.ts. */
@Component({
    selector: "app-shell",
    imports: [RouterLink, RouterLinkActive, RouterOutlet, IconComponent],
    templateUrl: "./app-shell.component.html",
    styleUrl: "./app-shell.component.css",
})
export class AppShellComponent {
    protected readonly auth = inject(AuthService);
    protected readonly theme = inject(ThemeService);
    protected readonly chatUi = inject(ChatUiStateService);

    protected readonly navItems: NavItem[] = [
        { path: "/chat", label: "Chat", icon: "chat" },
        { path: "/canais", label: "Canais", icon: "channels" },
        { path: "/cobranca", label: "Cobrança", icon: "billing" },
        { path: "/perfil", label: "Perfil", icon: "profile" },
    ];

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
    }

    fmtWhen(iso: string): string {
        const diffH = Math.round((Date.now() - new Date(iso).getTime()) / 3600000);
        if (diffH < 1) return "agora";
        if (diffH < 24) return `${diffH}h atrás`;
        return `${Math.round(diffH / 24)}d atrás`;
    }
}
