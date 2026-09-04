import type { ElementRef } from "@angular/core";
import { Component, computed, effect, inject, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { HistoryEntry, PendingConfirmation } from "../../core/chat.service";
import { ChatService } from "../../core/chat.service";
import { ChatUiStateService } from "../../core/chat-ui-state.service";
import { IconComponent } from "../../shared/icon.component";

interface HistoryState {
    entries: HistoryEntry[];
    total: number;
    loaded: number;
    pending: PendingConfirmation | null;
}

/** O que fazer com a rolagem na PRÓXIMA vez que `entries` mudar — setado antes de disparar a mudança, consumido pelo effect de rolagem. */
type ScrollIntent = "bottom" | "preserve-top" | null;

const EMPTY_HISTORY: HistoryState = { entries: [], total: 0, loaded: 0, pending: null };

@Component({
    selector: "app-chat",
    imports: [FormsModule, IconComponent],
    templateUrl: "./chat.component.html",
    styleUrl: "./chat.component.css",
})
export class ChatComponent {
    private readonly chat = inject(ChatService);
    protected readonly chatUi = inject(ChatUiStateService);

    private readonly messagesEl = viewChild<ElementRef<HTMLDivElement>>("messagesEl");
    private readonly composerInput = viewChild<ElementRef<HTMLInputElement>>("composerInput");

    private readonly historyBySession = signal<Record<string, HistoryState>>({});
    protected composerText = "";
    protected readonly chatError = signal("");

    private scrollIntent: ScrollIntent = null;
    private scrollHeightBeforeLoad = 0;

    protected readonly activeHistory = computed<HistoryState>(() => {
        const id = this.chatUi.activeSessionId();
        return (id && this.historyBySession()[id]) || EMPTY_HISTORY;
    });

    protected readonly activeTitle = computed(() => {
        const id = this.chatUi.activeSessionId();
        if (!id) return "Nova conversa";
        return this.chatUi.sessions().find((s) => s.id === id)?.title || "Conversa";
    });

    constructor() {
        effect(() => {
            const id = this.chatUi.activeSessionId();
            if (id && !this.historyBySession()[id]) {
                this.scrollIntent = "bottom";
                void this.loadHistory(id, 0, true);
            }
        });

        // Roda toda vez que as mensagens da conversa ativa mudam — decide rolar pro fim (nova
        // mensagem) ou preservar a posição de leitura (carregou mensagens mais antigas no topo).
        effect(() => {
            this.activeHistory().entries;
            const intent = this.scrollIntent;
            this.scrollIntent = null;
            const el = this.messagesEl()?.nativeElement;
            if (!el || !intent) return;
            queueMicrotask(() => {
                if (intent === "bottom") el.scrollTop = el.scrollHeight;
                else el.scrollTop = el.scrollHeight - this.scrollHeightBeforeLoad;
            });
        });
    }

    private async loadHistory(sessionId: string, offset: number, replace: boolean): Promise<void> {
        try {
            const page = await this.chat.history(sessionId, offset);
            this.historyBySession.update((map) => {
                const prevEntries = replace ? [] : (map[sessionId]?.entries ?? []);
                return {
                    ...map,
                    [sessionId]: { entries: [...page.entries, ...prevEntries], total: page.total, loaded: offset + page.entries.length, pending: map[sessionId]?.pending ?? null },
                };
            });
        } catch (err) {
            this.chatError.set(err instanceof Error ? err.message : "Falha ao carregar histórico.");
        }
    }

    loadOlder(): void {
        const id = this.chatUi.activeSessionId();
        if (!id) return;
        this.scrollIntent = "preserve-top";
        this.scrollHeightBeforeLoad = this.messagesEl()?.nativeElement.scrollHeight ?? 0;
        void this.loadHistory(id, this.activeHistory().loaded, false);
    }

    async send(): Promise<void> {
        const text = this.composerText.trim();
        if (!text) return;
        this.composerText = "";
        this.chatError.set("");
        this.focusComposer();
        const sessionId = this.chatUi.activeSessionId();

        if (sessionId) {
            this.scrollIntent = "bottom";
            this.historyBySession.update((map) => {
                const h = map[sessionId] ?? EMPTY_HISTORY;
                return { ...map, [sessionId]: { ...h, entries: [...h.entries, this.localEntry(sessionId, "user", text)] } };
            });
        }

        try {
            const res = await this.chat.send(text, sessionId ?? undefined);
            const newId = res.sessionId;
            this.scrollIntent = "bottom";
            this.historyBySession.update((map) => {
                const h = map[newId] ?? EMPTY_HISTORY;
                const entries = sessionId ? h.entries : [...h.entries, this.localEntry(newId, "user", text)];
                return {
                    ...map,
                    [newId]: {
                        entries: [...entries, this.localEntry(newId, "assistant", res.text)],
                        total: h.total + 2,
                        loaded: h.loaded + 2,
                        pending: res.pending?.length ? res.pending[0]! : null,
                    },
                };
            });
            this.chatUi.setActiveSession(newId);
            if (!sessionId) void this.chatUi.refresh();
        } catch (err) {
            this.chatError.set(err instanceof Error ? err.message : "Falha ao enviar mensagem.");
        } finally {
            this.focusComposer();
        }
    }

    async resolve(approved: boolean): Promise<void> {
        const id = this.chatUi.activeSessionId();
        const pending = this.activeHistory().pending;
        if (!id || !pending) return;
        try {
            const res = await this.chat.resolve(id, pending.tool, pending.ref, approved, approved ? undefined : "Recusado pelo usuário no painel.");
            this.scrollIntent = "bottom";
            this.historyBySession.update((map) => {
                const cur = map[id]!;
                return {
                    ...map,
                    [id]: { ...cur, entries: [...cur.entries, this.localEntry(id, "assistant", res.text)], pending: res.pending?.length ? res.pending[0]! : null },
                };
            });
        } catch (err) {
            this.chatError.set(err instanceof Error ? err.message : "Falha ao resolver aprovação.");
        }
    }

    pendingInputLabel(pending: PendingConfirmation): string {
        return JSON.stringify(pending.input, null, 2);
    }

    private focusComposer(): void {
        queueMicrotask(() => this.composerInput()?.nativeElement.focus());
    }

    private localEntry(sessionId: string, role: "user" | "assistant", text: string): HistoryEntry {
        return { id: `local-${role}-${Date.now()}-${Math.random()}`, sessionId, userId: "", role, text, createdAt: new Date().toISOString() };
    }
}
