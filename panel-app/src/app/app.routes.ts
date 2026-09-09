import type { Routes } from "@angular/router";
import { authGuard, guestGuard } from "./core/auth.guard";
import { AppShellComponent } from "./shell/app-shell.component";

export const routes: Routes = [
    {
        path: "login",
        canActivate: [guestGuard],
        loadComponent: () => import("./pages/auth/auth.component").then((m) => m.AuthComponent),
    },
    {
        path: "",
        component: AppShellComponent,
        canActivate: [authGuard],
        children: [
            { path: "chat", loadComponent: () => import("./pages/chat/chat.component").then((m) => m.ChatComponent) },
            { path: "projetos", loadComponent: () => import("./pages/projects/projects.component").then((m) => m.ProjectsComponent) },
            { path: "projetos/:id", loadComponent: () => import("./pages/project-detail/project-detail.component").then((m) => m.ProjectDetailComponent) },
            { path: "canais", loadComponent: () => import("./pages/channels/channels.component").then((m) => m.ChannelsComponent) },
            { path: "contatos", loadComponent: () => import("./pages/contacts/contacts.component").then((m) => m.ContactsComponent) },
            { path: "integracoes", loadComponent: () => import("./pages/mcp-guide/mcp-guide.component").then((m) => m.McpGuideComponent) },
            { path: "perfil", loadComponent: () => import("./pages/profile/profile.component").then((m) => m.ProfileComponent) },
            { path: "cobranca", loadComponent: () => import("./pages/billing/billing.component").then((m) => m.BillingComponent) },
            { path: "", pathMatch: "full", redirectTo: "chat" },
        ],
    },
    { path: "**", redirectTo: "chat" },
];
