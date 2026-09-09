import { Injectable, effect, inject, signal } from "@angular/core";
import { ChatProgressService } from "./chat-progress.service";

export type ToastKind = "success" | "warn" | "danger";

export interface ToastEntry {
    id: number;
    kind: ToastKind;
    message: string;
}

const AUTO_DISMISS_MS = 9000;

/**
 * Avisos "empurrados" pelo backend fora de qualquer turno de chat em
 * andamento — `job_done` (shell em segundo plano) e `project_event`
 * (Project da equipe de dev pausou/concluiu). Deriva de
 * `ChatProgressService#latest` (mesmo socket `/ws/chat-progress` que a
 * página de Chat já usa pra "chamando ferramenta...") — antes destes dois
 * tipos, esses avisos chegavam mas ficavam invisíveis fora da tela de
 * Chat. Mostrado globalmente (montado uma vez no AppShell), não só
 * enquanto o Chat está aberto.
 */
@Injectable({ providedIn: "root" })
export class ToastService {
    private readonly chatProgress = inject(ChatProgressService);
    private nextId = 0;

    readonly toasts = signal<ToastEntry[]>([]);

    constructor() {
        effect(() => {
            const event = this.chatProgress.latest();
            if (!event) return;

            if (event.type === "job_done") {
                this.push(event.ok ? "success" : "danger", event.summary);
            } else if (event.type === "project_event") {
                this.push(event.kind === "completed" ? "success" : "warn", event.summary);
            }
        });
    }

    push(kind: ToastKind, message: string): void {
        const id = this.nextId++;
        this.toasts.update((list) => [...list, { id, kind, message }]);
        setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
    }

    dismiss(id: number): void {
        this.toasts.update((list) => list.filter((t) => t.id !== id));
    }
}
