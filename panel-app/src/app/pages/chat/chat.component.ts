import type { ElementRef } from "@angular/core";
import { Component, computed, effect, inject, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { DomSanitizer, type SafeHtml } from "@angular/platform-browser";
import { API_BASE_URL } from "../../core/api-base.token";
import type { DataFileKind, HistoryEntry, PendingConfirmation, UploadedDataFile } from "../../core/chat.service";
import { ChatService } from "../../core/chat.service";
import { ChatUiStateService } from "../../core/chat-ui-state.service";
import { FilePreviewModalComponent, type ModalFile } from "../../shared/file-preview-modal.component";
import { IconComponent } from "../../shared/icon.component";
import { renderMessageHtml } from "../../shared/markdown-html";

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
    imports: [FormsModule, IconComponent, FilePreviewModalComponent],
    templateUrl: "./chat.component.html",
    styleUrl: "./chat.component.css",
})
export class ChatComponent {
    private readonly chat = inject(ChatService);
    protected readonly chatUi = inject(ChatUiStateService);
    private readonly sanitizer = inject(DomSanitizer);
    private readonly apiBaseUrl = inject(API_BASE_URL);

    private readonly messagesEl = viewChild<ElementRef<HTMLDivElement>>("messagesEl");
    private readonly composerInput = viewChild<ElementRef<HTMLInputElement>>("composerInput");

    private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>("fileInput");

    private readonly historyBySession = signal<Record<string, HistoryState>>({});
    protected composerText = "";
    protected readonly chatError = signal("");
    /** Planilha/CSV anexada nesta composição — some depois de enviada junto de uma mensagem (ver send()), nunca sobrevive entre mensagens. */
    protected readonly attachedFile = signal<UploadedDataFile | null>(null);
    protected readonly uploading = signal(false);
    /** Card clicado numa bolha (delegação de evento — ver onBubbleClick) — null quando o modal está fechado. */
    protected readonly activeModal = signal<ModalFile | null>(null);

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

    triggerAttach(): void {
        this.fileInput()?.nativeElement.click();
    }

    async onFileSelected(event: Event): Promise<void> {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        input.value = ""; // permite escolher o MESMO arquivo de novo depois (change não dispara se o value não mudar).
        if (!file) return;

        this.chatError.set("");
        this.uploading.set(true);
        try {
            this.attachedFile.set(await this.chat.uploadFile(file));
        } catch (err) {
            this.chatError.set(err instanceof Error ? err.message : "Falha ao enviar arquivo.");
        } finally {
            this.uploading.set(false);
        }
    }

    clearAttachment(): void {
        this.attachedFile.set(null);
    }

    async send(): Promise<void> {
        const text = this.composerText.trim();
        if (!text) return;
        this.composerText = "";
        this.chatError.set("");
        this.focusComposer();
        const sessionId = this.chatUi.activeSessionId();
        const file = this.attachedFile();
        const fileId = file?.fileId;
        this.attachedFile.set(null);

        if (sessionId) {
            this.scrollIntent = "bottom";
            this.historyBySession.update((map) => {
                const h = map[sessionId] ?? EMPTY_HISTORY;
                return { ...map, [sessionId]: { ...h, entries: [...h.entries, this.localEntry(sessionId, "user", text, file)] } };
            });
        }

        try {
            const res = await this.chat.send(text, sessionId ?? undefined, fileId);
            const newId = res.sessionId;
            this.scrollIntent = "bottom";
            this.historyBySession.update((map) => {
                const h = map[newId] ?? EMPTY_HISTORY;
                const entries = sessionId ? h.entries : [...h.entries, this.localEntry(newId, "user", text, file)];
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

    /** Markdown → HTML seguro (negrito/link/lista/etc — ver shared/markdown-html.ts). `bypassSecurityTrustHtml` é seguro aqui porque quem monta o HTML já escapa todo texto e valida esquema de URL antes — nunca passa o texto cru direto. */
    renderedText(text: string): SafeHtml {
        return this.sanitizer.bypassSecurityTrustHtml(renderMessageHtml(text, this.apiBaseUrl));
    }

    /**
     * O card de preview vive dentro de HTML injetado via `[innerHTML]` — um
     * `(click)` do Angular no próprio card nunca dispararia. Em vez disso um
     * único listener na bolha (delegação de evento) sobe a árvore a partir
     * de `event.target` até achar `.file-preview-card` e lê os `data-*`.
     */
    onBubbleClick(event: Event): void {
        const target = event.target as HTMLElement | null;
        const card = target?.closest(".file-preview-card") as HTMLElement | null;
        if (!card) return;
        const { fileId, kind, downloadUrl, filename } = card.dataset;
        if (!fileId || !kind || !downloadUrl || !filename) return;
        this.activeModal.set({ fileId, kind: kind as DataFileKind, downloadUrl, filename });
    }

    private focusComposer(): void {
        queueMicrotask(() => this.composerInput()?.nativeElement.focus());
    }

    /**
     * `file`, quando presente, vira um link markdown `[nome](url)` concatenado
     * ao texto — passa pelo MESMO `renderMessageHtml` que qualquer mensagem
     * (ver template), então o eco local ganha o preview-card de graça, sem
     * precisar montar HTML na mão aqui. Só existe nesta carga de página — o
     * histórico persistido no backend não guarda referência a arquivo por
     * mensagem, recarregar perde esse eco (limitação conhecida, aceita).
     */
    private localEntry(sessionId: string, role: "user" | "assistant", text: string, file?: UploadedDataFile | null): HistoryEntry {
        const fullText = file ? `${text}\n\n[${file.filename}](${file.downloadUrl})` : text;
        return { id: `local-${role}-${Date.now()}-${Math.random()}`, sessionId, userId: "", role, text: fullText, createdAt: new Date().toISOString() };
    }
}
