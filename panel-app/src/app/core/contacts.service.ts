import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

/** Categorias liberáveis pra um contato de confiança, sem virar dono — espelha GRANTABLE_TOOLS do backend-v2 (contacts/grantable-tools.ts). */
export type GrantableTool = "notes" | "tasks" | "events";

/** Espelha o retorno de ContactsService/ContactsController no backend-v2. */
export interface ContactSummary {
    id: string;
    channel: "whatsapp" | "telegram";
    contactId: string;
    name: string;
    relationship?: string;
    organization?: string;
    notes?: string;
    grantedTools?: GrantableTool[];
    createdAt: string;
    updatedAt: string;
}

/** Tudo opcional — PATCH parcial (apelido, anotações, permissão especial), mesmo padrão de UpdateMcpConnectionInput. */
export interface UpdateContactInput {
    name?: string;
    relationship?: string;
    organization?: string;
    notes?: string;
    grantedTools?: GrantableTool[];
}

@Injectable({ providedIn: "root" })
export class ContactsService {
    private readonly http = inject(HttpClient);

    list(): Promise<ContactSummary[]> {
        return firstValueFrom(this.http.get<ContactSummary[]>("/contacts"));
    }

    update(id: string, input: UpdateContactInput): Promise<ContactSummary> {
        return firstValueFrom(this.http.patch<ContactSummary>(`/contacts/${id}`, input));
    }

    async delete(id: string): Promise<boolean> {
        const res = await firstValueFrom(this.http.delete<{ deleted: boolean }>(`/contacts/${id}`));
        return res.deleted;
    }
}
