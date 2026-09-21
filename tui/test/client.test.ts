import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { Server } from "node:http";

// HOME isolado ANTES de importar o daemon: nada escreve no ~/.config/helena real.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-tui-test-"));
process.env.HOME = fakeHome;
process.env.HELENA_CONFIG_DIR = path.join(fakeHome, ".config", "helena"); // o os.homedir() do Bun ignora HOME alterado em runtime

const { startLocalApi } = await import("../../src/local-api/server.ts");
const { createEventHub } = await import("../../src/local-api/event-hub.ts");
const { createSessionManager } = await import("../../src/local-api/session-manager.ts");
const { loadOrCreateLocalToken } = await import("../../src/local-api/local-token.ts");
const { createLocalApi, LocalApiError, readLocalToken } = await import("../src/api/client.ts");
const { connectEvents } = await import("../src/api/events.ts");

let backend: ReturnType<typeof Bun.serve>;
let daemon: Server;
let baseUrl: string;
let token: string;
const seen: Array<{ method: string; path: string; auth: string | null; body: string }> = [];
const hub = createEventHub();

beforeAll(async () => {
    backend = Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            seen.push({ method: req.method, path: url.pathname + url.search, auth: req.headers.get("authorization"), body: await req.text() });
            if (url.pathname === "/auth/login") return Response.json({ accessToken: "JWT-1", user: { id: "u1", email: "a@b.c" } }, { status: 201 });
            if (url.pathname === "/chat/messages") return Response.json({ sessionId: "s1", text: "oi!", toolActivity: [{ name: "shell", input: { command: "ls" } }] });
            if (url.pathname === "/chat/sessions") return Response.json([{ id: "s1", title: "Conversa", updatedAt: "2026-09-21T10:00:00Z" }]);
            if (url.pathname.endsWith("/history")) return Response.json({ entries: [], total: 0, limit: 20, offset: 0 });
            if (url.pathname === "/contacts") return Response.json([{ id: "c1" }]);
            return Response.json({ message: "não achei" }, { status: 404 });
        },
    });
    token = loadOrCreateLocalToken();
    const session = createSessionManager({ backendUrl: `http://127.0.0.1:${backend.port}`, store: { load: () => undefined, save() {}, clear() {} }, hub });
    daemon = startLocalApi({ port: 0, version: "t", localToken: token, session, hub, machineName: "maq-tui" });
    await new Promise<void>((r) => (daemon.listening ? r() : daemon.once("listening", () => r())));
    baseUrl = `http://127.0.0.1:${(daemon.address() as { port: number }).port}`;
});
afterAll(() => {
    daemon.close();
    backend.stop(true);
    fs.rmSync(fakeHome, { recursive: true, force: true });
});

describe("cliente da API local contra o DAEMON REAL", () => {
    test("readLocalToken lê o mesmo arquivo que o daemon criou (0600)", () => {
        expect(readLocalToken()).toBe(token);
        expect(fs.statSync(path.join(fakeHome, ".config", "helena", "local-token")).mode & 0o777).toBe(0o600);
    });

    test("health sem token; token errado vira LocalApiError 401; daemon fora do ar vira daemon_unreachable", async () => {
        const ok = createLocalApi({ baseUrl, token });
        expect((await ok.health()).apiVersion).toBe(1);
        const bad = createLocalApi({ baseUrl, token: "errado" });
        await expect(bad.sessionStatus()).rejects.toMatchObject({ status: 401, code: "unauthorized" });
        const down = createLocalApi({ baseUrl: "http://127.0.0.1:1", token });
        await expect(down.health()).rejects.toMatchObject({ code: "daemon_unreachable" });
    });

    test("login → só {user}; chat passa pelo daemon com o JWT do daemon e o machineName injetado", async () => {
        const api = createLocalApi({ baseUrl, token });
        const { user } = await api.login("a@b.c", "senha");
        expect(user.email).toBe("a@b.c");
        seen.length = 0;
        const r = await api.sendMessage("olá", "s1");
        expect(r.text).toBe("oi!");
        const chat = seen.find((s) => s.path === "/chat/messages")!;
        expect(chat.auth).toBe("Bearer JWT-1");
        expect(JSON.parse(chat.body)).toEqual({ text: "olá", sessionId: "s1", machineName: "maq-tui" });
        expect((await api.sessions())[0]!.title).toBe("Conversa");
        seen.length = 0;
        await api.history("s1", 100, 200);
        expect(seen[0]!.path).toBe("/chat/sessions/s1/history?limit=100&offset=200");
        expect(await api.backend("GET", "contacts")).toEqual([{ id: "c1" }]);
    });

    test("erro do backend mantém a mensagem original em LocalApiError", async () => {
        const api = createLocalApi({ baseUrl, token });
        await expect(api.backend("GET", "contacts/nao-existe")).rejects.toBeInstanceOf(LocalApiError);
    });

    test("connectEvents: token no SUBPROTOCOLO, recebe hello+state, eventos ao vivo e reconecta com ?since=", async () => {
        const got: Array<{ type: string }> = [];
        const statuses: string[] = [];
        const conn = connectEvents({ baseUrl, token, onEvent: (e) => got.push(e), onStatus: (s) => statuses.push(s), minDelayMs: 50 });
        await Bun.sleep(300);
        expect(got.map((e) => e.type)).toContain("hello");
        expect(got.map((e) => e.type)).toContain("state");
        hub.publish("chat.progress", { type: "turn_start" });
        hub.publish("job_done", { jobId: "j1", ok: true, summary: "feito" });
        await Bun.sleep(200);
        expect(got.some((e) => e.type === "chat.progress")).toBe(true);
        expect(statuses).toContain("open");
        conn.close();
        const bad = connectEvents({ baseUrl, token: "errado", onEvent: () => {}, onStatus: (s) => statuses.push(`bad:${s}`), minDelayMs: 50 });
        await Bun.sleep(300);
        bad.close();
        expect(statuses).toContain("bad:closed"); // token errado nunca abre
        expect(statuses).not.toContain("bad:open");
    });
});
