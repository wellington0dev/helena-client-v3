/**
 * Fala o MESMO protocolo REST que o painel Angular fala com o backend-v2
 * (ver client/panel-app/src/app/core/{auth,chat}.service.ts) — login por
 * email/senha, JWT no header `Authorization`, `/chat/messages`/
 * `/chat/sessions/:id/resolve`. Função pura, não classe — mesma razão de
 * client/src/channels/backend-client.ts (este pacote roda `.ts` nativo,
 * sem build; classe com parâmetro de construtor não sobrevive ao
 * strip-only do Node).
 */

export interface PendingConfirmation {
    tool: string;
    ref?: string;
    input: unknown;
}

/** Chamada + resultado de UMA tool do turno — ver extract-tool-activity.ts no backend-v2. Só vem preenchido pra conversa do próprio dono (nunca contato externo/grupo, que nem usa este CLI). */
export interface ToolActivityEntry {
    name: string;
    input?: unknown;
    output?: unknown;
}

/** Tokens/duração da chamada de IA deste turno — ver SendMessageResult#usage no backend-v2. */
export interface TurnUsage {
    inputTokens?: number;
    outputTokens?: number;
    durationMs: number;
}

export interface SendMessageResult {
    sessionId: string;
    text: string;
    pending?: PendingConfirmation[];
    toolActivity?: ToolActivityEntry[];
    usage?: TurnUsage;
}

/** Distinta de um erro genérico pra chat.ts saber quando vale a pena relogar em vez de só mostrar o erro. */
export class UnauthorizedError extends Error {}

async function parseOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        if (response.status === 401) throw new UnauthorizedError(`sessão expirada ou inválida: ${body}`);
        throw new Error(`backend-v2 respondeu ${response.status}: ${body}`);
    }
    return response.json() as Promise<T>;
}

export async function login(baseUrl: string, email: string, password: string): Promise<string> {
    const response = await fetch(`${baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const { accessToken } = await parseOrThrow<{ accessToken: string }>(response);
    return accessToken;
}

export interface SendMessageInput {
    text: string;
    sessionId?: string;
    cwd?: string;
    machineName?: string;
}

export async function sendMessage(baseUrl: string, token: string, input: SendMessageInput): Promise<SendMessageResult> {
    const response = await fetch(`${baseUrl}/chat/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
    });
    return parseOrThrow<SendMessageResult>(response);
}

export async function resolveInterrupt(baseUrl: string, token: string, sessionId: string, tool: string, ref: string | undefined, approved: boolean, reason?: string): Promise<SendMessageResult> {
    const response = await fetch(`${baseUrl}/chat/sessions/${sessionId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tool, ref, approved, reason }),
    });
    return parseOrThrow<SendMessageResult>(response);
}
