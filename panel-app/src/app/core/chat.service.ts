import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export interface ChatSession {
    id: string;
    userId: string;
    ownerScope: string;
    title?: string;
    createdAt: string;
    updatedAt: string;
}

export interface HistoryEntry {
    id: string;
    sessionId: string;
    userId: string;
    role: "user" | "assistant";
    text: string;
    senderName?: string;
    createdAt: string;
}

export interface PaginatedHistory {
    entries: HistoryEntry[];
    total: number;
    limit: number;
    offset: number;
}

export interface PendingConfirmation {
    tool: string;
    ref?: string;
    input: unknown;
}

export interface SendMessageResult {
    sessionId: string;
    text: string;
    pending?: PendingConfirmation[];
}

export type DataFileKind = "csv" | "xlsx" | "image";

export interface UploadedDataFile {
    fileId: string;
    filename: string;
    kind: DataFileKind;
    downloadUrl: string;
    /** Só presente pra kind "csv"/"xlsx" — imagem não tem coluna/linha. */
    columns?: string[];
    rowCount?: number;
}

export interface DataFilePreview {
    columns: string[];
    rows: (string | number | null)[][];
    totalRows: number;
}

/** `offset=0` é sempre a página mais recente — "carregar mais antigas" avança o offset (ver docs/architecture-v2.md e client-panel-brief.md). */
export const CHAT_PAGE_SIZE = 50;

@Injectable({ providedIn: "root" })
export class ChatService {
    private readonly http = inject(HttpClient);

    listSessions(): Promise<ChatSession[]> {
        return firstValueFrom(this.http.get<ChatSession[]>("/chat/sessions"));
    }

    history(sessionId: string, offset: number): Promise<PaginatedHistory> {
        return firstValueFrom(this.http.get<PaginatedHistory>(`/chat/sessions/${sessionId}/history?limit=${CHAT_PAGE_SIZE}&offset=${offset}`));
    }

    send(text: string, sessionId?: string, fileId?: string): Promise<SendMessageResult> {
        return firstValueFrom(this.http.post<SendMessageResult>("/chat/messages", { text, sessionId, fileId }));
    }

    /** `FormData` — sem header manual (authInterceptor já cuida do Bearer; Content-Type multipart o próprio navegador define, com o boundary certo). */
    uploadFile(file: File): Promise<UploadedDataFile> {
        const formData = new FormData();
        formData.append("file", file);
        return firstValueFrom(this.http.post<UploadedDataFile>("/data-files/upload", formData));
    }

    /** Primeiras linhas de uma planilha já enviada — pro modal de preview (nunca chamado pra imagem, que não tem linha nenhuma). */
    previewRows(fileId: string): Promise<DataFilePreview | { error: string }> {
        return firstValueFrom(this.http.get<DataFilePreview | { error: string }>(`/data-files/${fileId}/preview`));
    }

    resolve(sessionId: string, tool: string, ref: string | undefined, approved: boolean, reason?: string): Promise<SendMessageResult> {
        return firstValueFrom(this.http.post<SendMessageResult>(`/chat/sessions/${sessionId}/resolve`, { tool, ref, approved, reason }));
    }
}
