import { Injectable, inject, signal } from "@angular/core";
import type { ChatSession } from "./chat.service";
import { ChatService } from "./chat.service";

/**
 * Lista de conversas mora na SIDEBAR (visível em qualquer tela do shell, não
 * só em /chat) — este serviço é o estado compartilhado entre AppShellComponent
 * (renderiza a lista) e ChatComponent (lê/atualiza a sessão ativa), sem
 * precisar de um serviço pai/filho ou @Input/@Output atravessando o router-outlet.
 */
@Injectable({ providedIn: "root" })
export class ChatUiStateService {
    private readonly chat = inject(ChatService);

    readonly sessions = signal<ChatSession[]>([]);
    readonly loaded = signal(false);
    readonly activeSessionId = signal<string | null>(null);

    async ensureLoaded(): Promise<void> {
        if (this.loaded()) return;
        await this.refresh();
    }

    async refresh(): Promise<void> {
        const sessions = await this.chat.listSessions();
        this.sessions.set(sessions);
        this.loaded.set(true);
        if (!this.activeSessionId() && sessions.length > 0) this.activeSessionId.set(sessions[0]!.id);
    }

    selectSession(id: string): void {
        this.activeSessionId.set(id);
    }

    newConversation(): void {
        this.activeSessionId.set(null);
    }

    setActiveSession(id: string): void {
        this.activeSessionId.set(id);
    }
}
