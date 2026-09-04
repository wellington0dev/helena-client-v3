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

    send(text: string, sessionId?: string): Promise<SendMessageResult> {
        return firstValueFrom(this.http.post<SendMessageResult>("/chat/messages", { text, sessionId }));
    }

    resolve(sessionId: string, tool: string, ref: string | undefined, approved: boolean, reason?: string): Promise<SendMessageResult> {
        return firstValueFrom(this.http.post<SendMessageResult>(`/chat/sessions/${sessionId}/resolve`, { tool, ref, approved, reason }));
    }
}
