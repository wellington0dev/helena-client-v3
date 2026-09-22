import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http, { type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

// HOME isolado ANTES de importar — nada escreve no ~/.config/helena real.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-localapi2-test-"));
const originalHome = process.env.HOME;
process.env.HOME = fakeHome;

const { patchFileConfig, loadFileConfig, publicView, importEnvOnce, configFilePath } = await import("./config-store.ts");
const { checkPathAccess } = await import("./path-policy.ts");
const { hardenPermissions, looseSecrets } = await import("./harden.ts");
const { runDoctor } = await import("./doctor.ts");
const { startLocalApi } = await import("./server.ts");
const { createEventHub } = await import("./event-hub.ts");
const { createSessionManager } = await import("./session-manager.ts");
const { loadOrCreateLocalToken, readLocalToken } = await import("./local-token.ts");
const files = await import("../local-files.ts");
const { config } = await import("../config.ts");

after(() => {
    process.env.HOME = originalHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
});

// ---------------- config-store ----------------
test("config: PATCH valida, grava 0600, remove com null e recusa chave desconhecida sem gravar nada", () => {
    let r = patchFileConfig({ machineName: "notebook", backgroundShellTimeoutMinutes: 45 });
    assert.ok(r.ok);
    assert.deepEqual(r.ok && r.changed.sort(), ["backgroundShellTimeoutMinutes", "machineName"]);
    assert.deepEqual(r.ok && r.restartRequired, ["machineName"]);
    assert.equal(fs.statSync(configFilePath()).mode & 0o777, 0o600);

    const before = fs.readFileSync(configFilePath(), "utf8");
    r = patchFileConfig({ machineName: "outro", naoExiste: 1 });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.errors.naoExiste, "chave desconhecida");
    assert.equal(fs.readFileSync(configFilePath(), "utf8"), before, "PATCH inválido não grava nada (nem a parte válida)");

    r = patchFileConfig({ backgroundShellTimeoutMinutes: 0 });
    assert.equal(r.ok, false);
    r = patchFileConfig({ machineName: null });
    assert.ok(r.ok && r.changed.includes("machineName"));
    assert.equal(loadFileConfig().machineName, undefined);
});

test("config: segredo (token do Telegram) é validado, gravado e NUNCA aparece na visão pública", () => {
    assert.equal(patchFileConfig({ telegramBotToken: "abc" }).ok, false);
    const token = "123456789:AAE-abcdefghijklmnopqrstuvwxyz012345";
    assert.ok(patchFileConfig({ telegramBotToken: token }).ok);
    const view = publicView(loadFileConfig());
    assert.equal(view.telegramBotTokenSet, true);
    assert.equal(JSON.stringify(view).includes(token), false);
});

test("config: importEnvOnce só importa se ainda não existe config.json", () => {
    fs.rmSync(configFilePath());
    const first = importEnvOnce({ BACKEND_V2_URL: "http://x:1", MEDIA_MAX_MB: "30", TELEGRAM_BOT_TOKEN: "lixo" } as NodeJS.ProcessEnv);
    assert.deepEqual(first.imported.sort(), ["backendUrl", "mediaMaxMb"]); // token inválido não entra
    assert.deepEqual(importEnvOnce({ BACKEND_V2_URL: "http://outra" } as NodeJS.ProcessEnv).imported, []);
    assert.equal(loadFileConfig().backendUrl, "http://x:1");
});

// ---------------- path-policy + local-files ----------------
const project = fs.mkdtempSync(path.join(fakeHome, "proj-"));
fs.writeFileSync(path.join(project, "app.ts"), "console.log('ok')");
fs.writeFileSync(path.join(project, ".env"), "SEGREDO=1");
fs.writeFileSync(path.join(project, ".env.example"), "SEGREDO=");
fs.writeFileSync(path.join(project, "chave.pem"), "-----BEGIN-----");
fs.mkdirSync(path.join(fakeHome, ".ssh"), { recursive: true });
fs.writeFileSync(path.join(fakeHome, ".ssh", "id_ed25519"), "privada");

test("política: nega .env, .pem, ~/.ssh e a pasta de config da Helena; libera .env.example e código", () => {
    const p = { allowedDirs: [], deniedPaths: [] };
    assert.equal(checkPathAccess(path.join(project, "app.ts"), p).ok, true);
    assert.equal(checkPathAccess(path.join(project, ".env.example"), p).ok, true);
    for (const denied of [path.join(project, ".env"), path.join(project, "chave.pem"), path.join(fakeHome, ".ssh", "id_ed25519"), path.join(fakeHome, ".config", "helena", "local-token"), "~/.ssh"]) {
        assert.equal(checkPathAccess(denied, p).ok, false, denied);
    }
});

test("política: allowedDirs restringe e link simbólico não escapa", () => {
    const outside = fs.mkdtempSync(path.join(fakeHome, "fora-"));
    fs.writeFileSync(path.join(outside, "x.txt"), "x");
    fs.symlinkSync(outside, path.join(project, "atalho"));
    const p = { allowedDirs: [project], deniedPaths: [] };
    assert.equal(checkPathAccess(path.join(project, "app.ts"), p).ok, true);
    assert.equal(checkPathAccess(path.join(outside, "x.txt"), p).ok, false);
    assert.equal(checkPathAccess(path.join(project, "atalho", "x.txt"), p).ok, false, "symlink pra fora é resolvido e negado");
    assert.equal(checkPathAccess(path.join(project, "novo", "arquivo.ts"), p).ok, true, "alvo que ainda não existe dentro da área permitida");
    assert.equal(checkPathAccess(path.join(project, "..", "fora-x"), p).ok, false, "../ escapando");
});

test("local-files aplica a política: lê código, recusa .env, não lista nem busca o que é protegido, não escreve", () => {
    assert.equal(files.readFile(path.join(project, "app.ts")).error, undefined);
    assert.match(files.readFile(path.join(project, ".env")).error ?? "", /Acesso negado/);
    const listed = files.listFiles(project).files.map((f) => f.name);
    assert.ok(listed.includes("app.ts") && listed.includes(".env.example"));
    assert.equal(listed.includes(".env"), false);
    assert.equal(listed.includes("chave.pem"), false);
    assert.equal(files.searchFiles(project, undefined, "SEGREDO").paths.some((p) => p.endsWith(".env")), false, "busca por conteúdo não entra no .env");
    assert.match(files.writeFile(path.join(project, ".env"), [{ type: "replace_all", content: "x" }]).error ?? "", /Acesso negado/);
    assert.match(files.deleteFile(path.join(project, ".env")).error ?? "", /Acesso negado/);
    assert.equal(fs.readFileSync(path.join(project, ".env"), "utf8"), "SEGREDO=1");
    config.allowedDirs = [project];
    assert.match(files.listFiles(os.tmpdir()).error ?? "", /Acesso negado/);
    config.allowedDirs = [];
});

// ---------------- harden + doctor ----------------
test("harden: arquivos → 0600, diretórios → 0700, recursivo, sem seguir links; looseSecrets enxerga o que está frouxo", () => {
    const dir = fs.mkdtempSync(path.join(fakeHome, "auth-"));
    fs.chmodSync(dir, 0o755);
    fs.writeFileSync(path.join(dir, "creds.json"), "{}", { mode: 0o644 });
    fs.mkdirSync(path.join(dir, "sub"), { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "sub", "k.json"), "{}", { mode: 0o666 });
    const alvoLink = path.join(fakeHome, "alvo-frouxo");
    fs.writeFileSync(alvoLink, "x", { mode: 0o644 });
    fs.symlinkSync(alvoLink, path.join(dir, "link"));
    assert.ok(looseSecrets([dir]).length >= 3);
    const { fixed } = hardenPermissions([dir, path.join(fakeHome, "nao-existe")]);
    assert.ok(fixed.length >= 3);
    assert.equal(looseSecrets([dir]).length, 0);
    assert.equal(fs.statSync(path.join(dir, "creds.json")).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(dir, "sub")).mode & 0o777, 0o700);
    assert.equal(fs.statSync(alvoLink).mode & 0o777, 0o644, "o alvo do link não foi tocado");
});

test("doctor: reporta backend, sessão, canais, permissões e bind — sem vazar segredo", async () => {
    const hub = createEventHub();
    hub.setState("channels", { whatsapp: { status: "connected" }, telegram: { status: "error" }, machineAgent: { status: "connecting" } });
    const session = createSessionManager({ backendUrl: "http://x", store: { load: () => undefined, save() {}, clear() {} }, hub });
    const fetchImpl = (async () => new Response("{}", { status: 200 })) as typeof fetch;
    const loose = path.join(fakeHome, "frouxo.txt");
    fs.writeFileSync(loose, "s", { mode: 0o644 });
    const r = await runDoctor({ backendUrl: "http://x", session, hub, fetchImpl, deviceTokenPresent: false, secretPaths: [loose], listenHost: "0.0.0.0", version: "t" });
    const by = Object.fromEntries(r.checks.map((c) => [c.name, c.status]));
    assert.equal(by.backend, "ok");
    assert.equal(by["sessão"], "warn");
    assert.equal(by.WhatsApp, "ok");
    assert.equal(by.Telegram, "fail");
    assert.equal(by["permissões"], "warn");
    assert.equal(by["bind da API local"], "warn");
    assert.equal(r.ok, false);
    const down = await runDoctor({ backendUrl: "http://x", session, hub, fetchImpl: (async () => { throw new Error("recusou"); }) as typeof fetch, deviceTokenPresent: true, secretPaths: [], listenHost: "127.0.0.1", version: "t" });
    assert.equal(down.checks[0].status, "fail");
});

// ---------------- rotas /v1/config, /v1/channels, /v1/machine, /v1/doctor, rotação ----------------
let api: Server;
let apiUrl: string;
const calls: string[] = [];
const hub = createEventHub();
let LOCAL = "";

before(async () => {
    LOCAL = loadOrCreateLocalToken();
    hub.setState("channels", { whatsapp: { status: "qr", qrText: "QR-TEXT" }, telegram: { status: "disconnected" }, machineAgent: { status: "connected", machineName: "m1" } });
    const session = createSessionManager({ backendUrl: "http://127.0.0.1:1", store: { load: () => undefined, save() {}, clear() {} }, hub });
    api = startLocalApi({
        port: 0, version: "t", localToken: LOCAL, session, hub,
        channels: {
            info: () => ({ telegramTokenSet: true }),
            whatsapp: { start: () => void calls.push("wa.start"), stop: async () => void calls.push("wa.stop"), logout: async () => void calls.push("wa.logout") },
            telegram: {
                start: () => void calls.push("tg.start"),
                stop: async () => void calls.push("tg.stop"),
                setToken: async (t) => (t.startsWith("1") || t === "" ? (calls.push(`tg.token:${t === "" ? "vazio" : "ok"}`), { ok: true }) : { ok: false, error: "formato inválido" }),
            },
        },
        configApi: { get: () => ({ file: {}, effective: {} }), patch: (p) => (p.ruim ? { ok: false, errors: { ruim: "não" } } : { ok: true, config: p, changed: Object.keys(p), restartRequired: [] }) },
        machine: () => ({ name: "m1", platform: "linux" }),
        doctor: async () => ({ ok: true, checks: [] }),
    });
    await new Promise<void>((r) => (api.listening ? r() : api.once("listening", () => r())));
    apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});
after(() => api.close());

const h = () => ({ Authorization: `Bearer ${LOCAL}`, "Content-Type": "application/json" });

test("rotas novas exigem token; GET /v1/channels devolve estado + tokenSet (sem segredo)", async () => {
    assert.equal((await fetch(`${apiUrl}/v1/channels`)).status, 401);
    const r = await fetch(`${apiUrl}/v1/channels`, { headers: h() });
    const body = (await r.json()) as any;
    assert.equal(body.whatsapp.status, "qr");
    assert.equal(body.whatsapp.qrText, "QR-TEXT");
    assert.equal(body.telegram.tokenSet, true);
});

test("ações de canal chamam o controlador; telegram/token PUT valida e nunca ecoa o token", async () => {
    calls.length = 0;
    for (const p of ["whatsapp/start", "whatsapp/stop", "whatsapp/logout", "telegram/start", "telegram/stop"]) {
        assert.equal((await fetch(`${apiUrl}/v1/channels/${p}`, { method: "POST", headers: h() })).status, 200, p);
    }
    assert.deepEqual(calls, ["wa.start", "wa.stop", "wa.logout", "tg.start", "tg.stop"]);
    assert.equal((await fetch(`${apiUrl}/v1/channels/telegram/logout`, { method: "POST", headers: h() })).status, 404);
    const ok = await fetch(`${apiUrl}/v1/channels/telegram/token`, { method: "PUT", headers: h(), body: JSON.stringify({ token: "123:segredo" }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.text()).includes("segredo"), false);
    const bad = await fetch(`${apiUrl}/v1/channels/telegram/token`, { method: "PUT", headers: h(), body: JSON.stringify({ token: "zzz" }) });
    assert.equal(bad.status, 422);
    assert.equal((await bad.text()).includes("zzz"), false);
    assert.equal((await fetch(`${apiUrl}/v1/channels/telegram/token`, { method: "DELETE", headers: h() })).status, 200);
    assert.equal((await fetch(`${apiUrl}/v1/channels/telegram/token`, { method: "PUT", headers: h(), body: "nao-json" })).status, 400);
});

test("/v1/config: GET, PATCH ok e 422 com os erros por chave; /v1/machine e /v1/doctor", async () => {
    assert.equal((await fetch(`${apiUrl}/v1/config`, { headers: h() })).status, 200);
    const ok = await fetch(`${apiUrl}/v1/config`, { method: "PATCH", headers: h(), body: JSON.stringify({ machineName: "x" }) });
    assert.deepEqual(((await ok.json()) as any).changed, ["machineName"]);
    const bad = await fetch(`${apiUrl}/v1/config`, { method: "PATCH", headers: h(), body: JSON.stringify({ ruim: 1 }) });
    assert.equal(bad.status, 422);
    assert.equal(((await bad.json()) as any).errors.ruim, "não");
    assert.equal(((await (await fetch(`${apiUrl}/v1/machine`, { headers: h() })).json()) as any).name, "m1");
    assert.equal(((await (await fetch(`${apiUrl}/v1/doctor`, { headers: h() })).json()) as any).ok, true);
});

test("rotação: token antigo deixa de valer, o novo vale, o arquivo muda e as conexões WS antigas caem", async () => {
    const old = LOCAL;
    const ws = new WebSocket(`ws://127.0.0.1:${(api.address() as { port: number }).port}/v1/events`, [`helena.bearer.${old}`]);
    await new Promise<void>((r) => ws.on("open", () => r()));
    const closed = new Promise<void>((r) => ws.on("close", () => r()));
    const r = await fetch(`${apiUrl}/v1/local-token/rotate`, { method: "POST", headers: h() });
    assert.equal(r.status, 200);
    const { token } = (await r.json()) as { token: string };
    assert.notEqual(token, old);
    assert.equal(readLocalToken(), token);
    await closed;
    assert.equal((await fetch(`${apiUrl}/v1/channels`, { headers: { Authorization: `Bearer ${old}` } })).status, 401);
    assert.equal((await fetch(`${apiUrl}/v1/channels`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    LOCAL = token;
});
