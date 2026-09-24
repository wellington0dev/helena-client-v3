import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionManager } from "./session-manager.ts";

/**
 * Passagem autenticada ao backend — NÃO é um proxy aberto: só prefixos da allowlist, sem nunca repassar
 * `Authorization`/`Cookie` de quem chamou (o JWT vem do `SessionManager`), com teto de corpo e timeout.
 * A lista final deve sair de um inventário do que a TUI realmente chama (docs/plano-evolucao-v3.md §4.2).
 */
export const BACKEND_ALLOWLIST = [
    "contacts",
    "mcp-connections",
    "billing",
    "payments",
    "dashboard",
    "telemetry",
    "feedback",
    "auth/me", // cobre auth/me e auth/me/* (preferências, owner-identity)
    "auth/api-tokens",
    "auth/sessions", // dispositivos/sessões ativas (refresh token) e revogação
] as const;

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
export const MAX_BODY_BYTES = 1_000_000;

export function isAllowedBackendPath(path: string): boolean {
    if (path.includes("..") || path.includes("//") || path.includes("\\")) return false;
    return BACKEND_ALLOWLIST.some((prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`));
}

export async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Buffer | "too_large"> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > limit) return "too_large";
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}

/** 413 sem deixar a conexão keep-alive num estado quebrado: fecha a conexão e descarta o resto do corpo. */
export function payloadTooLarge(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader("Connection", "close");
    req.resume();
    sendJson(res, 413, { message: "Corpo grande demais.", error: "payload_too_large", statusCode: 413 });
}

/** Encaminha `req` para `backendPath` (já sem o prefixo `/v1/...`) e devolve status + corpo do backend. */
export async function forward(session: SessionManager, req: IncomingMessage, res: ServerResponse, backendPath: string): Promise<void> {
    const method = req.method ?? "GET";
    if (!ALLOWED_METHODS.has(method)) return sendJson(res, 405, { message: "Método não permitido.", error: "method_not_allowed", statusCode: 405 });
    const body = method === "GET" || method === "DELETE" ? undefined : await readBody(req);
    if (body === "too_large") return payloadTooLarge(req, res);

    const headers: Record<string, string> = {};
    const contentType = req.headers["content-type"];
    if (contentType && body && body.length > 0) headers["Content-Type"] = String(contentType);

    let upstream: Response;
    try {
        upstream = await session.authedFetch(backendPath, { method, headers, ...(body && body.length > 0 ? { body } : {}) });
    } catch (error) {
        return sendJson(res, 502, { message: `Backend indisponível: ${error instanceof Error ? error.message : String(error)}`, error: "backend_unreachable", statusCode: 502 });
    }
    const payload = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8" });
    res.end(payload);
}
