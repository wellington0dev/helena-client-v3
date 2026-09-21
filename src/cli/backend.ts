/**
 * Fala o MESMO protocolo REST que o painel Angular fala com o backend-v2
 * (ver client/panel-app/src/app/core/{auth,chat}.service.ts) — login por
 * email/senha, JWT no header `Authorization`, `/chat/messages`/
 * `/chat/sessions/:id/resolve`. Função pura, não classe — mesma razão de
 * client/src/channels/backend-client.ts (este pacote roda `.ts` nativo,
 * sem build; classe com parâmetro de construtor não sobrevive ao
 * strip-only do Node).
 *
 * `authed`/`parseOrThrow`/`UnauthorizedError` vivem em `api/http.ts`
 * (compartilhado com os módulos de domínio em `api/*.ts` — Contatos/MCP/
 * Projetos/etc) — reexporta `UnauthorizedError` pra não quebrar quem já
 * importa daqui (`app.ts`/`chat.ts`).
 */
import { authed, parseOrThrow, UnauthorizedError } from "./api/http.ts";

export { UnauthorizedError };

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
    /** Quanto de `inputTokens` veio do cache implícito do Gemini (ver captureUsageMiddleware no backend-v2) — o backend já manda isso, só não era mostrado aqui. */
    cachedTokens?: number;
    /** Tokens de "pensamento" do Gemini — cobrados pela Google à taxa de OUTPUT, mas fora de `outputTokens` (ver captureUsageMiddleware no backend-v2). Ausente em turnos gravados antes de 2026-09-19. */
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

/**
 * Endpoints de `/config` no terminal — mesmo protocolo REST que o painel
 * fala (ver panel-app/src/app/core/{auth,profile}.service.ts). Autenticado
 * (JWT do login por email/senha, mesmo `token` do resto deste arquivo).
 * `authed` vem de `api/http.ts` (ver import no topo).
 */
export type UserRole = "admin" | "user" | "tester";

export interface CurrentUser {
    id: string;
    email: string;
    displayName?: string;
    role: UserRole;
    telemetryConsent: boolean;
    autoApproveShell: boolean;
    allowProactiveMessages: boolean;
    whatsappOwnerNumber?: string;
    telegramOwnerId?: string;
    createdAt: string;
}

export function getMe(baseUrl: string, token: string): Promise<CurrentUser> {
    return authed(baseUrl, token, "GET", "/auth/me");
}

export function setTelemetryConsent(baseUrl: string, token: string, consent: boolean): Promise<{ telemetryConsent: boolean }> {
    return authed(baseUrl, token, "PATCH", "/auth/me/telemetry-consent", { consent });
}

export function setAutoApproveShell(baseUrl: string, token: string, enabled: boolean): Promise<{ autoApproveShell: boolean }> {
    return authed(baseUrl, token, "PATCH", "/auth/me/auto-approve-shell", { enabled });
}

export function setProactiveMessages(baseUrl: string, token: string, enabled: boolean): Promise<{ allowProactiveMessages: boolean }> {
    return authed(baseUrl, token, "PATCH", "/auth/me/allow-proactive-messages", { enabled });
}

export interface ApiTokenSummary {
    id: string;
    label?: string;
    createdAt: string;
    lastUsedAt?: string | null;
}

export interface CreatedApiToken extends ApiTokenSummary {
    /** Só vem nesta resposta, uma vez — nunca mais recuperável depois. */
    token: string;
}

export function listApiTokens(baseUrl: string, token: string): Promise<ApiTokenSummary[]> {
    return authed(baseUrl, token, "GET", "/auth/api-tokens");
}

export function createApiToken(baseUrl: string, token: string, label?: string): Promise<CreatedApiToken> {
    return authed(baseUrl, token, "POST", "/auth/api-tokens", { label });
}

export function revokeApiToken(baseUrl: string, token: string, id: string): Promise<{ revoked: boolean }> {
    return authed(baseUrl, token, "DELETE", `/auth/api-tokens/${id}`);
}
