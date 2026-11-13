import type { EventHub } from "./event-hub.ts";

/**
 * Dono das credenciais de USUÁRIO do backend (access JWT + refresh token). A TUI nunca vê nenhum dos dois: ela
 * pede login/logout ao daemon e usa as rotas `/v1/*`, que passam por `authedFetch` aqui.
 *
 * Renovação (docs/plano-evolucao-v3.md §4.4): preventiva (perto de expirar) e reativa (401 → uma única repetição).
 *  - SINGLE-FLIGHT: refresh é rotativo; duas renovações paralelas com o mesmo token disparariam a detecção de
 *    reuso do backend e derrubariam a sessão. Chamadas concorrentes esperam a MESMA promessa.
 *  - O par novo é GRAVADO EM DISCO ANTES de ser usado (se o processo cair no meio, o servidor ainda tolera o token
 *    antigo por 30 s e o arquivo nunca fica com um token já consumido).
 *  - Refresh rejeitado (401/400 = inválido, expirado, revogado, reutilizado) → sessão limpa + `session.expired`.
 *    Falha de REDE/5xx NÃO desloga: mantém o estado e tenta de novo na próxima chamada.
 *  - Sessão legada (JWT sem refresh token): 401 ⇒ expirou, como antes.
 */
export interface SessionStore {
    load(): { accessToken: string; refreshToken?: string } | undefined;
    save(accessToken: string, refreshToken?: string): void;
    clear(): void;
}

export interface SessionManagerOptions {
    backendUrl: string | (() => string);
    store: SessionStore;
    hub: EventHub;
    fetchImpl?: typeof fetch;
    /** Chamado (sem esperar) depois de login/registro bem-sucedido — ex.: provisionar o token de dispositivo. */
    onLogin?: (accessToken: string) => void | Promise<void>;
    /** Desliga integrações locais quando a sessão é revogada ou expira. */
    onLogout?: () => void | Promise<void>;
    /** Nome desta máquina, enviado no login só pra o usuário reconhecer a sessão em `GET /auth/sessions`. */
    deviceLabel?: string;
    /** Renova quando faltar menos que isto pro access token expirar (padrão 60 s). */
    refreshLeewayMs?: number;
}

export interface SessionManager {
    isLoggedIn(): boolean;
    login(email: string, password: string): Promise<{ user: unknown }>;
    register(email: string, password: string, displayName?: string): Promise<{ user: unknown }>;
    /** JWT válido para um handshake WS; renova preventivamente usando o refresh token mantido pelo daemon. */
    getAccessToken(): Promise<string | undefined>;
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

function jwtExpiryMs(token: string): number | undefined {
    try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
        return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
    } catch {
        return undefined;
    }
}

type RefreshOutcome = "ok" | "rejected" | "network";

export function createSessionManager(options: SessionManagerOptions): SessionManager {
    const { store, hub } = options;
    function backendBaseUrl(): string {
        const configured = typeof options.backendUrl === "function" ? options.backendUrl() : options.backendUrl;
        if (!configured?.trim()) throw new HttpError(503, "O endereço do servidor central não está configurado nesta versão do aplicativo. Atualize a instalação ou contate o administrador.");
        try {
            const url = new URL(configured.trim());
            if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocolo inválido");
            return url.toString().replace(/\/$/, "");
        } catch {
            throw new HttpError(503, "A configuração do servidor central desta instalação é inválida. Atualize a instalação ou contate o administrador.");
        }
    }
    const doFetch = options.fetchImpl ?? fetch;
    const leeway = options.refreshLeewayMs ?? 60_000;
    const loaded = store.load();
    let token = loaded?.accessToken;
    let refreshToken = loaded?.refreshToken;
    let expiresAt = token ? jwtExpiryMs(token) : undefined;
    let inflight: Promise<RefreshOutcome> | undefined;

    hub.setState("session", { loggedIn: Boolean(token) });

    function setSession(access: string | undefined, refresh?: string, expiresInSeconds?: number): void {
        if (access) store.save(access, refresh); // grava ANTES de trocar em memória
        else store.clear();
        token = access;
        refreshToken = access ? refresh : undefined;
        expiresAt = access ? (expiresInSeconds ? Date.now() + expiresInSeconds * 1000 : jwtExpiryMs(access)) : undefined;
        hub.setState("session", { loggedIn: Boolean(access) });
    }

    function expire(): void {
        setSession(undefined);
        hub.publish("session.expired", { reason: "backend_401" });
        void Promise.resolve(options.onLogout?.()).catch(() => undefined);
    }

    async function authenticate(path: string, body: Record<string, unknown>): Promise<{ user: unknown }> {
        const payload = { ...body, ...(options.deviceLabel ? { deviceLabel: options.deviceLabel } : {}) };
        const response = await doFetch(`${backendBaseUrl()}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) throw new HttpError(response.status, await messageOf(response));
        const parsed = (await response.json()) as { accessToken?: string; refreshToken?: string; expiresIn?: number; user?: unknown };
        if (!parsed.accessToken) throw new HttpError(502, "Resposta do backend sem accessToken.");
        setSession(parsed.accessToken, parsed.refreshToken, parsed.expiresIn);
        void Promise.resolve(options.onLogin?.(parsed.accessToken)).catch(() => undefined);
        return { user: parsed.user };
    }

    function refresh(): Promise<RefreshOutcome> {
        if (!refreshToken) return Promise.resolve("rejected");
        if (inflight) return inflight;
        const used = refreshToken;
        inflight = (async (): Promise<RefreshOutcome> => {
            let response: Response;
            try {
                response = await doFetch(`${backendBaseUrl()}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: used }), signal: AbortSignal.timeout(15_000) });
            } catch {
                return "network";
            }
            if (response.status === 401 || response.status === 400) return "rejected";
            if (!response.ok) return "network"; // 5xx/429: o servidor não disse que a sessão morreu
            try {
                const parsed = (await response.json()) as { accessToken?: string; refreshToken?: string; expiresIn?: number };
                if (!parsed.accessToken || !parsed.refreshToken) return "network";
                setSession(parsed.accessToken, parsed.refreshToken, parsed.expiresIn);
                return "ok";
            } catch {
                return "network";
            }
        })().finally(() => {
            inflight = undefined;
        });
        return inflight;
    }

    function call(path: string, init: RequestInit): Promise<Response> {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${token}`);
        // Turnos reais de chat podem levar vários minutos (o teste com S5-free levou até 10 min e 40 s). Não abortar o
        // proxy antes de o backend responder: o turno continuaria rodando e seria cobrado mesmo sem resposta no client.
        return doFetch(`${backendBaseUrl()}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(15 * 60_000) });
    }

    const noSession = () => new Response(JSON.stringify({ message: "Sem sessão — faça login.", error: "no_session", statusCode: 401 }), { status: 401, headers: { "Content-Type": "application/json" } });

    return {
        isLoggedIn: () => Boolean(token),
        async getAccessToken() {
            if (!token) return undefined;
            if (refreshToken && expiresAt !== undefined && expiresAt - Date.now() < leeway) {
                const outcome = await refresh();
                if (outcome === "rejected") {
                    expire();
                    return undefined;
                }
                if (outcome === "network" && expiresAt !== undefined && expiresAt <= Date.now()) return undefined;
            } else if (expiresAt !== undefined && expiresAt <= Date.now()) {
                expire();
                return undefined;
            }
            return token;
        },
        login: (email, password) => authenticate("/auth/login", { email, password }),
        register: (email, password, displayName) => authenticate("/auth/register", { email, password, ...(displayName ? { displayName } : {}) }),
        logout() {
            const rt = refreshToken;
            setSession(undefined);
            void Promise.resolve(options.onLogout?.()).catch(() => undefined);
            // avisa o backend (revoga a família) sem esperar nem falhar por isso
            if (rt) void doFetch(`${backendBaseUrl()}/auth/logout`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: rt }), signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
        },
        adoptToken(accessToken) {
            setSession(accessToken); // legado: JWT sem refresh
            void Promise.resolve(options.onLogin?.(accessToken)).catch(() => undefined);
        },
        async authedFetch(path, init = {}) {
            if (!token) return noSession();
            if (refreshToken && expiresAt !== undefined && expiresAt - Date.now() < leeway) {
                if ((await refresh()) === "rejected") {
                    expire();
                    return noSession();
                }
            }
            if (!token) return noSession();
            const response = await call(path, init);
            if (response.status !== 401) return response;

            if (!refreshToken) {
                expire();
                return response;
            }
            const outcome = await refresh();
            if (outcome === "rejected") {
                expire();
                return response;
            }
            if (outcome === "network" || !token) return response; // não dá pra concluir; a sessão continua guardada
            const retried = await call(path, init);
            if (retried.status === 401) expire();
            return retried;
        },
    };
}
