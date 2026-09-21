/** Formas trocadas com a API local (`/v1`, que repassa o backend). Espelham client/src/cli/backend.ts e o `history` do backend. */
export interface PendingConfirmation {
    tool: string;
    ref?: string;
    input: unknown;
}
export interface ToolActivityEntry {
    name: string;
    input?: unknown;
    output?: unknown;
}
export interface TurnUsage {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    thoughtsTokens?: number;
    durationMs: number;
}
export interface SendMessageResult {
    sessionId: string;
    text: string;
    pending?: PendingConfirmation[];
    toolActivity?: ToolActivityEntry[];
    usage?: TurnUsage;
}
export interface HistoryEntry {
    id: string;
    role: string;
    text: string;
    senderName?: string;
    createdAt: string;
}
/** `offset` conta a partir da mensagem MAIS RECENTE; `entries` vêm em ordem cronológica. */
export interface HistoryPage {
    entries: HistoryEntry[];
    total: number;
    limit: number;
    offset: number;
}
export interface ChatSessionSummary {
    id: string;
    title?: string;
    updatedAt: string;
}
export interface HubEvent {
    id?: number;
    ts?: number;
    type: string;
    data?: unknown;
    replayed?: boolean;
}
export type ChannelStatus = "disconnected" | "connecting" | "qr" | "connected" | "error";
export interface ChannelsSnapshot {
    whatsapp: { status: ChannelStatus; qrText?: string; error?: string };
    telegram: { status: ChannelStatus; error?: string; tokenSet?: boolean };
    machineAgent: { status: ChannelStatus; machineName?: string; error?: string };
}
export interface DoctorReport {
    ok: boolean;
    version: string;
    checks: Array<{ name: string; status: "ok" | "warn" | "fail"; detail: string }>;
}
export interface Me {
    id: string;
    email: string;
    displayName?: string;
    role: string;
    telemetryConsent: boolean;
    autoApproveShell: boolean;
    allowProactiveMessages: boolean;
    whatsappOwnerNumber?: string;
    telegramOwnerId?: string;
}
export interface UsageSummary {
    totalCalls: number;
    firstCallAt?: string;
    lastCallAt?: string;
    callsByChannel: Record<string, number>;
    callsByDay: { date: string; calls: number }[];
}
