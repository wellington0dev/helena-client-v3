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

test("rotas de proxy e chat foram removidas e respondem 404", async () => {
    assert.equal((await fetch(`${apiUrl}/v1/chat/messages`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ text: "olá" }) })).status, 404);
    assert.equal((await fetch(`${apiUrl}/v1/chat/sessions`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${apiUrl}/v1/backend/contacts`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${apiUrl}/v1/session/login`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ email: "a@b.c", password: "123" }) })).status, 404);
    assert.equal((await fetch(`${apiUrl}/v1/session/me`, { headers: auth })).status, 404);
});

test("sessão local: status, adoção via cli-session e logout", async () => {
    // Inicia deslogado
    clearSession();
    assert.equal((await j(await fetch(`${apiUrl}/v1/session/status`, { headers: auth }))).loggedIn, false);

    // Adota token via cli-session
    const ok = await fetch(`${apiUrl}/cli-session`, { method: "POST", headers: auth, body: JSON.stringify({ accessToken: "JWT-TESTE-123" }) });
    assert.equal(ok.status, 200);
    assert.equal((await j(await fetch(`${apiUrl}/v1/session/status`, { headers: auth }))).loggedIn, true);

    // Logout local
    const logoutRes = await fetch(`${apiUrl}/v1/session/logout`, { method: "POST", headers: auth });
    assert.equal(logoutRes.status, 200);
    assert.equal((await j(await fetch(`${apiUrl}/v1/session/status`, { headers: auth }))).loggedIn, false);
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
