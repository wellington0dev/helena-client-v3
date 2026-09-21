import type { EventHub } from "./event-hub.ts";

/**
 * Dono das credenciais de USUÁRIO do backend (JWT). A TUI nunca vê o JWT: ela pede login/logout ao daemon e
 * usa as rotas `/v1/*`, que passam por `authedFetch` aqui. Hoje o backend não tem refresh token (R0b em
 * docs/plano-evolucao-v3.md §4.4): 401 ⇒ sessão expirou ⇒ evento `session.expired` no hub e a TUI pede a
 * senha de novo, sem perder a tela. Quando o refresh existir, é aqui (e só aqui) que a renovação entra.
 */
export interface SessionStore {
    load(): { accessToken: string } | undefined;
    save(accessToken: string): void;
    clear(): void;
}

export interface SessionManagerOptions {
    backendUrl: string;
    store: SessionStore;
    hub: EventHub;
    fetchImpl?: typeof fetch;
    /** Chamado (sem esperar) depois de login/registro bem-sucedido — ex.: provisionar o token de dispositivo. */
    onLogin?: (accessToken: string) => void | Promise<void>;
}

export interface SessionManager {
    isLoggedIn(): boolean;
    login(email: string, password: string): Promise<{ user: unknown }>;
    register(email: string, password: string, displayName?: string): Promise<{ user: unknown }>;
    logout(): void;
    /** Rota legada `/cli-session`: adota um JWT obtido por quem já logou direto no backend (CLI antigo). */
    adoptToken(accessToken: string): void;
    /** fetch ao backend com o JWT; 401 limpa a sessão e publica `session.expired`. Sem sessão: 401 sintético. */
    authedFetch(path: string, init?: RequestInit): Promise<Response>;
}

export class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

async function messageOf(response: Response): Promise<string> {
    const raw = await response.text().catch(() => "");
    try {
        const parsed = JSON.parse(raw) as { message?: string | string[] };
        if (typeof parsed.message === "string") return parsed.message;
        if (Array.isArray(parsed.message)) return parsed.message.join(" — ");
    } catch {
        // não era JSON.
    }
    return raw || `HTTP ${response.status}`;
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
    const { backendUrl, store, hub } = options;
    const doFetch = options.fetchImpl ?? fetch;
    let token = store.load()?.accessToken;

    hub.setState("session", { loggedIn: Boolean(token) });

    function setToken(next: string | undefined): void {
        token = next;
        if (next) store.save(next);
        else store.clear();
        hub.setState("session", { loggedIn: Boolean(next) });
    }

    async function authenticate(path: string, body: unknown): Promise<{ user: unknown }> {
        const response = await doFetch(`${backendUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!response.ok) throw new HttpError(response.status, await messageOf(response));
        const parsed = (await response.json()) as { accessToken?: string; user?: unknown };
        if (!parsed.accessToken) throw new HttpError(502, "Resposta do backend sem accessToken.");
        setToken(parsed.accessToken);
        void Promise.resolve(options.onLogin?.(parsed.accessToken)).catch(() => undefined);
        return { user: parsed.user };
    }

    return {
        isLoggedIn: () => Boolean(token),
        login: (email, password) => authenticate("/auth/login", { email, password }),
        register: (email, password, displayName) => authenticate("/auth/register", { email, password, ...(displayName ? { displayName } : {}) }),
        logout: () => setToken(undefined),
        adoptToken(accessToken) {
            setToken(accessToken);
            void Promise.resolve(options.onLogin?.(accessToken)).catch(() => undefined);
        },
        async authedFetch(path, init = {}) {
            if (!token) {
                return new Response(JSON.stringify({ message: "Sem sessão — faça login.", error: "no_session", statusCode: 401 }), { status: 401, headers: { "Content-Type": "application/json" } });
            }
            const headers = new Headers(init.headers);
            headers.set("Authorization", `Bearer ${token}`);
            const response = await doFetch(`${backendUrl}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(60_000) });
            if (response.status === 401) {
                setToken(undefined);
                hub.publish("session.expired", { reason: "backend_401" });
            }
            return response;
        },
    };
}
