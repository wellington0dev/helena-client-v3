import { HttpErrorResponse } from "@angular/common/http";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { ContactSummary, GrantableTool, UpdateContactInput } from "../../core/contacts.service";
import { ContactsService } from "../../core/contacts.service";
import { IconComponent } from "../../shared/icon.component";

interface ContactForm {
    id: string;
    name: string;
    notes: string;
    grantedTools: Record<GrantableTool, boolean>;
}

const GRANTABLE_OPTIONS: { key: GrantableTool; label: string }[] = [
    { key: "notes", label: "Notas" },
    { key: "tasks", label: "Tarefas" },
    { key: "events", label: "Agenda" },
];

function toForm(contact: ContactSummary): ContactForm {
    const granted = new Set(contact.grantedTools ?? []);
    return {
        id: contact.id,
        name: contact.name,
        notes: contact.notes ?? "",
        grantedTools: { notes: granted.has("notes"), tasks: granted.has("tasks"), events: granted.has("events") },
    };
}

function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && typeof err.error?.message === "string") return err.error.message;
    return err instanceof Error ? err.message : fallback;
}

/**
 * Página "Contatos": todo mundo que já mandou mensagem pro dono por
 * WhatsApp/Telegram (auto-criado em ChatService#sendExternalMessage) —
 * apelido/anotações (name/notes, já existiam no dado) e permissão especial
 * (grantedTools: notas/tarefas/agenda PRÓPRIAS, isoladas do dono, sem virar
 * dono — ver backend-v2/src/contacts/grantable-tools.ts). Sem "criar
 * contato" aqui: um contato só nasce de uma mensagem real recebida.
 */
@Component({
    selector: "app-contacts",
    imports: [FormsModule, IconComponent],
    templateUrl: "./contacts.component.html",
    styleUrl: "./contacts.component.css",
})
export class ContactsComponent {
    private readonly contacts = inject(ContactsService);

    protected readonly grantableOptions = GRANTABLE_OPTIONS;

    protected readonly list = signal<ContactSummary[]>([]);
    protected readonly loaded = signal(false);
    protected readonly error = signal("");
    protected readonly saving = signal(false);

    /** `null` = nenhum contato selecionado pra edição. */
    protected readonly form = signal<ContactForm | null>(null);
    protected readonly editingContact = computed(() => this.list().find((c) => c.id === this.form()?.id));

    constructor() {
        void this.reload();
    }

    private async reload(): Promise<void> {
        try {
            this.list.set(await this.contacts.list());
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Falha ao carregar os contatos."));
        } finally {
            this.loaded.set(true);
        }
    }

    hasGrantedTools(contact: ContactSummary): boolean {
        return (contact.grantedTools?.length ?? 0) > 0;
    }

    openEditForm(contact: ContactSummary): void {
        this.error.set("");
        this.form.set(toForm(contact));
    }

    closeForm(): void {
        this.form.set(null);
    }

    updateForm(patch: Partial<Omit<ContactForm, "grantedTools">>): void {
        const current = this.form();
        if (current) this.form.set({ ...current, ...patch });
    }

    toggleGrantedTool(tool: GrantableTool, checked: boolean): void {
        const current = this.form();
        if (current) this.form.set({ ...current, grantedTools: { ...current.grantedTools, [tool]: checked } });
    }

    async save(): Promise<void> {
        const current = this.form();
        if (!current || !current.name.trim()) return;

        const grantedTools = GRANTABLE_OPTIONS.filter((opt) => current.grantedTools[opt.key]).map((opt) => opt.key);
        const input: UpdateContactInput = { name: current.name.trim(), notes: current.notes.trim(), grantedTools };

        this.saving.set(true);
        this.error.set("");
        try {
            const updated = await this.contacts.update(current.id, input);
            this.list.update((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
            this.form.set(null);
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Falha ao salvar o contato."));
        } finally {
            this.saving.set(false);
        }
    }

    /** Otimista, mesmo padrão de mcp-guide.component.ts#remove — sem confirm() nativo (nenhuma outra tela do painel usa). Se a pessoa mandar mensagem de novo depois, um novo contato é criado do zero. */
    async remove(contact: ContactSummary): Promise<void> {
        const prev = this.list();
        this.list.update((rows) => rows.filter((row) => row.id !== contact.id));
        if (this.form()?.id === contact.id) this.form.set(null);
        try {
            await this.contacts.delete(contact.id);
        } catch (err) {
            this.list.set(prev);
            this.error.set(extractErrorMessage(err, "Falha ao remover o contato."));
        }
    }
}
