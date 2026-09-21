import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import os from "node:os";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { EventHub, HubEvent } from "./event-hub.ts";
import { tokensMatch } from "./local-token.ts";
import { forward, isAllowedBackendPath, MAX_BODY_BYTES, payloadTooLarge, readBody, sendJson } from "./proxy.ts";
import { HttpError, type SessionManager } from "./session-manager.ts";

/** Versão do contrato `/v1`. A TUI recusa daemon com `apiVersion` maior que o que conhece. */
export const API_VERSION = 1;

export interface LocalApiOptions {
    port: number;
    /** Padrão: loopback. Qualquer outro valor é opt-in explícito (ex.: IP da VPN) e continua exigindo o token. */
    host?: string;
    version: string;
    localToken: string;
    session: SessionManager;
    hub: EventHub;
    /** Nome desta máquina, injetado como contexto advisório nos turnos de chat quando a TUI não manda. */
    machineName?: string;
}

const BEARER_PROTOCOL = "helena.bearer.";

function bearerFrom(req: IncomingMessage): string | undefined {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice(7).trim();
    return undefined;
}

/** WS de navegador não manda `Authorization`: aceita o token no subprotocolo (preferido) ou em `?token=`. */
function wsTokenFrom(req: IncomingMessage): string | undefined {
    const protocols = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((p) => p.trim());
    const hit = protocols.find((p) => p.startsWith(BEARER_PROTOCOL));
    if (hit) return hit.slice(BEARER_PROTOCOL.length);
    const fromQuery = new URL(req.url ?? "/", "http://x").searchParams.get("token");
    return fromQuery ?? bearerFrom(req);
}

export function startLocalApi(options: LocalApiOptions): Server {
    const { session, hub } = options;
    const host = options.host ?? "127.0.0.1";
    const machineName = options.machineName ?? os.hostname();

    function deny(res: ServerResponse, status: number, error: string, message: string): void {
        sendJson(res, status, { message, error, statusCode: status });
    }

    /** Devolve true se passou. Rejeita qualquer requisição com `Origin` (navegador: CSRF/DNS-rebinding). */
    function authorize(req: IncomingMessage, res: ServerResponse, token: string | undefined): boolean {
        if (req.headers.origin) {
            deny(res, 403, "origin_forbidden", "Requisições de navegador não são aceitas.");
            return false;
        }
        if (!tokensMatch(options.localToken, token)) {
            res.setHeader("WWW-Authenticate", 'Bearer realm="helena-local"');
            deny(res, 401, "unauthorized", "Token local ausente ou inválido.");
            return false;
        }
        return true;
    }

    async function handleSession(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
        const method = req.method ?? "GET";
        if (path === "/v1/session/status" && method === "GET") return sendJson(res, 200, { loggedIn: session.isLoggedIn() });
        if (path === "/v1/session/me" && method === "GET") return forward(session, req, res, "/auth/me");
        if (path === "/v1/session/logout" && method === "POST") {
            session.logout();
            return sendJson(res, 200, { ok: true });
        }
        if ((path === "/v1/session/login" || path === "/v1/session/register") && method === "POST") {
            const raw = await readBody(req, 20_000);
            if (raw === "too_large") return payloadTooLarge(req, res);
            let body: { email?: string; password?: string; displayName?: string };
            try {
                body = JSON.parse(raw.toString("utf8")) as typeof body;
            } catch {
                return deny(res, 400, "invalid_json", "Corpo não é JSON válido.");
            }
            if (!body.email || !body.password) return deny(res, 400, "invalid_body", "email e password são obrigatórios.");
            try {
                const result = path.endsWith("login") ? await session.login(body.email, body.password) : await session.register(body.email, body.password, body.displayName);
                return sendJson(res, 200, result); // { user } — NUNCA o JWT
            } catch (error) {
                if (error instanceof HttpError) return deny(res, error.status, "backend_error", error.message);
                return deny(res, 502, "backend_unreachable", `Backend indisponível: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return deny(res, 404, "not_found", "Rota de sessão desconhecida.");
    }

    async function handleChat(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
        const backendPath = `/chat${path.slice("/v1/chat".length)}`;
        if (req.method === "POST" && path === "/v1/chat/messages") {
            // Injeta o nome da máquina como contexto advisório (a TUI hoje monta isso; agora é o daemon).
            const raw = await readBody(req, MAX_BODY_BYTES);
            if (raw === "too_large") return payloadTooLarge(req, res);
            let body: Record<string, unknown>;
            try {
                body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
            } catch {
                return deny(res, 400, "invalid_json", "Corpo não é JSON válido.");
            }
            if (body.machineName === undefined) body.machineName = machineName;
            const upstream = await session.authedFetch(backendPath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);
            if (!upstream) return deny(res, 502, "backend_unreachable", "Backend indisponível.");
            res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json" });
            res.end(Buffer.from(await upstream.arrayBuffer()));
            return;
        }
        return forward(session, req, res, backendPath + (req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""));
    }

    const server = createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url ?? "/", "http://x");
            const path = url.pathname;

            if (path === "/health" && req.method === "GET") {
                return sendJson(res, 200, { status: "ok", version: options.version, apiVersion: API_VERSION, session: { loggedIn: session.isLoggedIn() } });
            }
            if (!authorize(req, res, bearerFrom(req))) return;

            if (path.startsWith("/v1/session/")) return handleSession(req, res, path);
            if (path.startsWith("/v1/chat/")) return handleChat(req, res, path);
            if (path.startsWith("/v1/backend/")) {
                const backendPath = path.slice("/v1/backend/".length) + url.search;
                if (!isAllowedBackendPath(backendPath)) return deny(res, 403, "path_not_allowed", "Caminho fora da allowlist do daemon.");
                return forward(session, req, res, `/${backendPath}`);
            }
            // Rota LEGADA (CLI antigo): agora exige o token local.
            if (path === "/cli-session" && req.method === "POST") {
                const raw = await readBody(req, 10_000);
                try {
                    const { accessToken } = JSON.parse(raw === "too_large" ? "{}" : raw.toString("utf8")) as { accessToken?: string };
                    if (!accessToken) throw new Error("accessToken ausente.");
                    session.adoptToken(accessToken);
                    return sendJson(res, 200, { ok: true });
                } catch {
                    return sendJson(res, 400, { ok: false });
                }
            }
            return deny(res, 404, "not_found", "Rota desconhecida.");
        })().catch((error) => {
            if (!res.headersSent) deny(res, 500, "internal_error", error instanceof Error ? error.message : "erro interno");
            else res.end();
        });
    });

    // ---- WebSocket: /v1/events (novo) e /ws (legado: só o estado dos canais, formato antigo) ----
    const wss = new WebSocketServer({
        noServer: true,
        handleProtocols: (protocols) => [...protocols].find((p) => p.startsWith(BEARER_PROTOCOL)) ?? false,
    });

    server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const path = new URL(req.url ?? "/", "http://x").pathname;
        const known = path === "/v1/events" || path === "/ws";
        const reject = (status: number, text: string) => {
            socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
            socket.destroy();
        };
        if (!known) return reject(404, "Not Found");
        if (req.headers.origin) return reject(403, "Forbidden");
        if (!tokensMatch(options.localToken, wsTokenFrom(req))) return reject(401, "Unauthorized");
        wss.handleUpgrade(req, socket, head, (ws) => (path === "/ws" ? attachLegacy(ws) : attachEvents(ws, req)));
    });

    function attachEvents(ws: WebSocket, req: IncomingMessage): void {
        const send = (o: unknown) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));
        send({ type: "hello", data: { apiVersion: API_VERSION, version: options.version } });
        send({ type: "state", data: hub.snapshot() });
        const since = Number(new URL(req.url ?? "/", "http://x").searchParams.get("since") ?? 0);
        if (since > 0) for (const event of hub.missed(since)) send({ ...event, replayed: true });
        const off = hub.subscribe((event: HubEvent) => send(event));
        ws.on("close", off);
        ws.on("error", off);
    }

    function attachLegacy(ws: WebSocket): void {
        const channels = () => hub.snapshot().channels;
        if (channels()) ws.send(JSON.stringify(channels()));
        const off = hub.subscribe((event) => {
            if (event.type === "state.channels" && ws.readyState === ws.OPEN) ws.send(JSON.stringify(event.data));
        });
        ws.on("close", off);
        ws.on("error", off);
    }

    server.on("close", () => {
        for (const client of wss.clients) client.terminate();
        wss.close();
    });

    server.listen(options.port, host, () => {
        const address = server.address();
        const shown = typeof address === "object" && address ? address.port : options.port;
        console.log(`[api local] no ar em http://${host}:${shown} (apiVersion ${API_VERSION}; token local obrigatório)`);
    });

    return server;
}
