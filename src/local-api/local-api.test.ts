import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocket, WebSocketServer } from "ws";

// HOME isolado ANTES de importar (mesmo padrão de session-store.test.ts): nada escreve no ~/.config/helena real.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-localapi-test-"));
const originalHome = process.env.HOME;
process.env.HOME = fakeHome;

const { startLocalApi, API_VERSION } = await import("./server.ts");
const { createEventHub } = await import("./event-hub.ts");
const { createSessionManager } = await import("./session-manager.ts");
const { loadOrCreateLocalToken, rotateLocalToken, tokensMatch, localTokenPath } = await import("./local-token.ts");
const { startProgressUpstream } = await import("./progress-upstream.ts");
const { saveSession, loadSession, clearSession } = await import("../cli/session-store.ts");

interface Seen {
    method: string;
    url: string;
    authorization?: string;
    body: string;
}

let backend: Server;
let backendUrl: string;
let seen: Seen[] = [];
let backendMode: "ok" | "expired" = "ok";
let backendWss: WebSocketServer;

let api: Server;
let apiUrl: string;
const hub = createEventHub();
const LOCAL = loadOrCreateLocalToken();
const auth = { Authorization: `Bearer ${LOCAL}` };

before(async () => {
    backend = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            seen.push({ method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization, body: Buffer.concat(chunks).toString() });
            res.setHeader("Content-Type", "application/json");
            if (req.url === "/auth/login") return res.end(JSON.stringify({ accessToken: "JWT-DO-USUARIO", user: { id: "u1", email: "a@b.c" } }));
            if (backendMode === "expired" && req.headers.authorization) {
                res.statusCode = 401;
                return res.end(JSON.stringify({ message: "expirado" }));
            }
            if (req.url === "/auth/me") return res.end(JSON.stringify({ id: "u1" }));
            res.end(JSON.stringify({ ok: true, url: req.url, echoBody: req.method === "POST" ? Buffer.concat(chunks).toString() : undefined }));
        });
    });
    backendWss = new WebSocketServer({ server: backend, path: "/ws/chat-progress" });
    await new Promise<void>((r) => backend.listen(0, "127.0.0.1", r));
    backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

    const session = createSessionManager({ backendUrl, store: { load: () => loadSession(), save: saveSession, clear: clearSession }, hub });
    api = startLocalApi({ port: 0, version: "test", localToken: LOCAL, session, hub, machineName: "maquina-teste" });
    await new Promise<void>((r) => (api.listening ? r() : api.once("listening", () => r())));
    apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});

after(async () => {
    process.env.HOME = originalHome;
    api.close();
    backendWss.close();
    backend.close();
    fs.rmSync(fakeHome, { recursive: true, force: true });
});

const j = (r: Response) => r.json() as Promise<Record<string, unknown>>;

test("bind: escuta só em loopback por padrão", () => {
    assert.equal((api.address() as { address: string }).address, "127.0.0.1");
});

test("GET /health não exige token e informa apiVersion", async () => {
    const r = await fetch(`${apiUrl}/health`);
    assert.equal(r.status, 200);
    const body = await j(r);
    assert.equal(body.apiVersion, API_VERSION);
    assert.equal(body.status, "ok");
});

test("rotas /v1 recusam sem token, com token errado e com Origin de navegador (mesmo com token certo)", async () => {
    assert.equal((await fetch(`${apiUrl}/v1/session/status`)).status, 401);
    assert.equal((await fetch(`${apiUrl}/v1/session/status`, { headers: { Authorization: "Bearer errado" } })).status, 401);
    const withOrigin = await fetch(`${apiUrl}/v1/session/status`, { headers: { ...auth, Origin: "http://evil.example" } });
    assert.equal(withOrigin.status, 403);
    assert.equal((await fetch(`${apiUrl}/v1/session/status`, { headers: auth })).status, 200);
});

test("login: a TUI recebe só {user} — o JWT fica no daemon (e no session.json 0600)", async () => {
    seen = [];
    const r = await fetch(`${apiUrl}/v1/session/login`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.c", password: "senha-forte-123" }) });
    assert.equal(r.status, 200);
    const body = await j(r);
    assert.deepEqual(Object.keys(body), ["user"]);
    assert.equal(JSON.stringify(body).includes("JWT-DO-USUARIO"), false);
    assert.equal(loadSession()?.accessToken, "JWT-DO-USUARIO");
    const mode = fs.statSync(path.join(fakeHome, ".config", "helena", "session.json")).mode & 0o777;
    assert.equal(mode, 0o600);
});

test("login com corpo inválido → 400 e sem chamar o backend", async () => {
    seen = [];
    const r = await fetch(`${apiUrl}/v1/session/login`, { method: "POST", headers: auth, body: "não-json" });
    assert.equal(r.status, 400);
    assert.equal(seen.length, 0);
});

test("passagem: o backend recebe o JWT do daemon, NUNCA o token local nem um Authorization do chamador", async () => {
    seen = [];
    const r = await fetch(`${apiUrl}/v1/backend/contacts?limit=5`, { headers: { ...auth, Cookie: "sessao=x" } });
    assert.equal(r.status, 200);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "/contacts?limit=5");
    assert.equal(seen[0].authorization, "Bearer JWT-DO-USUARIO");
    assert.notEqual(seen[0].authorization, `Bearer ${LOCAL}`);
});

test("allowlist: prefixos fora da lista, login do backend e traversal são recusados sem tocar o backend", async () => {
    seen = [];
    for (const p of ["channels/inbound", "auth/login", "auth/register", "webhooks/asaas/x", "contacts/../channels/inbound", "..%2Fchannels", "//channels"]) {
        const r = await fetch(`${apiUrl}/v1/backend/${p}`, { headers: auth });
        assert.ok([403, 404].includes(r.status), `${p} → ${r.status}`);
    }
    assert.equal(seen.length, 0);
});

test("chat: POST /v1/chat/messages injeta machineName e preserva o resto; GET mantém a query", async () => {
    seen = [];
    await fetch(`${apiUrl}/v1/chat/messages`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ text: "olá", sessionId: "s1" }) });
    assert.equal(seen[0].url, "/chat/messages");
    assert.deepEqual(JSON.parse(seen[0].body), { text: "olá", sessionId: "s1", machineName: "maquina-teste" });
    await fetch(`${apiUrl}/v1/chat/messages`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ text: "x", machineName: "outra" }) });
    assert.equal(JSON.parse(seen[1].body).machineName, "outra");
    seen = [];
    await fetch(`${apiUrl}/v1/chat/sessions/abc/history?limit=20&offset=40`, { headers: auth });
    assert.equal(seen[0].url, "/chat/sessions/abc/history?limit=20&offset=40");
});

test("corpo acima do teto → 413", async () => {
    const big = "x".repeat(1_100_000);
    const r = await fetch(`${apiUrl}/v1/backend/contacts`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: big });
    assert.equal(r.status, 413);
});

test("401 do backend limpa a sessão e publica session.expired no hub", async () => {
    const events: string[] = [];
    const off = hub.subscribe((e) => events.push(e.type));
    backendMode = "expired";
    const r = await fetch(`${apiUrl}/v1/chat/sessions`, { headers: auth });
    backendMode = "ok";
    off();
    assert.equal(r.status, 401);
    assert.ok(events.includes("session.expired"));
    assert.equal(loadSession(), undefined);
    assert.equal((await j(await fetch(`${apiUrl}/v1/session/status`, { headers: auth }))).loggedIn, false);
    // sem sessão: 401 sintético, sem chamar o backend
    seen = [];
    assert.equal((await fetch(`${apiUrl}/v1/backend/contacts`, { headers: auth })).status, 401);
    assert.equal(seen.length, 0);
});

function openWs(pathAndQuery: string, protocols?: string[], headers?: Record<string, string>): Promise<{ ws: WebSocket; messages: any[] } | { status: number }> {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${(api.address() as { port: number }).port}${pathAndQuery}`, protocols, { headers });
        const messages: any[] = [];
        ws.on("message", (m) => messages.push(JSON.parse(String(m))));
        ws.on("open", () => resolve({ ws, messages }));
        ws.on("unexpected-response", (_req, res) => resolve({ status: res.statusCode ?? 0 }));
        ws.on("error", () => undefined);
    });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("WS /v1/events: sem token 401; com Origin 403; com subprotocolo recebe hello+state e depois os eventos", async () => {
    assert.deepEqual(await openWs("/v1/events"), { status: 401 });
    assert.deepEqual(await openWs("/v1/events", [`helena.bearer.${LOCAL}`], { Origin: "http://evil.example" }), { status: 403 });
    const c = (await openWs("/v1/events", [`helena.bearer.${LOCAL}`])) as { ws: WebSocket; messages: any[] };
    assert.equal(c.ws.protocol, `helena.bearer.${LOCAL}`);
    await sleep(50);
    assert.equal(c.messages[0].type, "hello");
    assert.equal(c.messages[0].data.apiVersion, API_VERSION);
    assert.equal(c.messages[1].type, "state");
    hub.publish("chat.progress", { type: "turn_start" });
    await sleep(50);
    assert.ok(c.messages.some((m) => m.type === "chat.progress" && m.data.type === "turn_start"));
    c.ws.close();
});

test("WS /v1/events?since=N reenvia o que foi perdido (job_done) marcado como replayed", async () => {
    hub.publish("job_done", { jobId: "j1" });
    const c = (await openWs("/v1/events?since=1", [`helena.bearer.${LOCAL}`])) as { ws: WebSocket; messages: any[] };
    await sleep(80);
    assert.ok(c.messages.some((m) => m.type === "job_done" && m.replayed === true));
    c.ws.close();
});

test("WS /ws (legado) exige token e manda o estado dos canais no formato antigo", async () => {
    assert.deepEqual(await openWs("/ws"), { status: 401 });
    hub.setState("channels", { whatsapp: { status: "qr" }, telegram: { status: "disconnected" }, machineAgent: { status: "disconnected" } });
    const c = (await openWs("/ws", [`helena.bearer.${LOCAL}`])) as { ws: WebSocket; messages: any[] };
    await sleep(50);
    assert.equal(c.messages[0].whatsapp.status, "qr");
    hub.setState("channels", { whatsapp: { status: "connected" }, telegram: { status: "disconnected" }, machineAgent: { status: "disconnected" } });
    await sleep(50);
    assert.equal(c.messages.at(-1).whatsapp.status, "connected");
    c.ws.close();
});

test("/cli-session (legado) agora exige o token local", async () => {
    assert.equal((await fetch(`${apiUrl}/cli-session`, { method: "POST", body: JSON.stringify({ accessToken: "x" }) })).status, 401);
    const ok = await fetch(`${apiUrl}/cli-session`, { method: "POST", headers: auth, body: JSON.stringify({ accessToken: "JWT-LEGADO" }) });
    assert.equal(ok.status, 200);
    assert.equal(loadSession()?.accessToken, "JWT-LEGADO");
});

test("token local: criado 0600, estável entre chamadas, rotacionável; comparação em tempo constante", () => {
    const file = localTokenPath();
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(loadOrCreateLocalToken(), LOCAL);
    assert.ok(LOCAL.length >= 32);
    const novo = rotateLocalToken();
    assert.notEqual(novo, LOCAL);
    assert.equal(tokensMatch(novo, novo), true);
    assert.equal(tokensMatch(novo, LOCAL), false);
    assert.equal(tokensMatch(novo, undefined), false);
    fs.writeFileSync(file, LOCAL, { mode: 0o600 }); // restaura p/ os demais testes
});

test("upstream de progresso: uma conexão ao backend repassa eventos ao hub e reconecta com backoff", async () => {
    const h2 = createEventHub();
    const got: any[] = [];
    h2.subscribe((e) => got.push(e));
    let connections = 0;
    backendWss.on("connection", (ws) => {
        connections++;
        ws.send(JSON.stringify({ type: "tool_call", name: "shell" }));
        ws.send(JSON.stringify({ type: "job_done", jobId: "j9" }));
        if (connections === 1) setTimeout(() => ws.close(), 60); // derruba a 1ª conexão
    });
    const up = startProgressUpstream({ backendUrl, hub: h2, getToken: () => "dev-token", minDelayMs: 30, maxDelayMs: 100 });
    await sleep(600);
    up.stop();
    assert.ok(connections >= 2, `reconectou (conexões: ${connections})`);
    assert.ok(got.some((e) => e.type === "chat.progress" && e.data.name === "shell"));
    assert.ok(h2.missed().some((e) => e.type === "job_done"), "job_done ficou no buffer de perdidos");
    assert.equal(h2.snapshot().backend, "ok");
});
