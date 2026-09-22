import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { daemon, DaemonUnavailableError } from "./daemon.ts";

const TOKEN = "t".repeat(40);
let dir: string;
let server: http.Server;
let port: number;
let seen: { method?: string; url?: string; auth?: string; body?: string }[] = [];
let mode: "ok" | "fail" = "ok";

test.before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-"));
    process.env.HELENA_CONFIG_DIR = dir;
    fs.writeFileSync(path.join(dir, "local-token"), TOKEN, { mode: 0o600 });
    server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
            seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
            if (mode === "fail") {
                res.writeHead(422, { "content-type": "application/json" });
                res.end(JSON.stringify({ message: "token recusado", error: "invalid_token", statusCode: 422 }));
                return;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, whatsapp: { status: "disconnected" }, telegram: { status: "connected", tokenSet: true } }));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
});

test.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.HELENA_CONFIG_DIR;
});

test("daemon: manda o token local no Authorization e usa o método/rota certos", async () => {
    seen = [];
    await daemon.whatsappLogout(port);
    await daemon.telegramStart(port);
    await daemon.removeTelegramToken(port);
    assert.deepEqual(seen.map((s) => `${s.method} ${s.url}`), ["POST /v1/channels/whatsapp/logout", "POST /v1/channels/telegram/start", "DELETE /v1/channels/telegram/token"]);
    assert.ok(seen.every((s) => s.auth === `Bearer ${TOKEN}`));
});

test("daemon: setTelegramToken manda { token } em PUT e devolve o estado dos canais em channels()", async () => {
    seen = [];
    await daemon.setTelegramToken(port, "123456789:AAEexample");
    assert.equal(seen[0]!.method, "PUT");
    assert.deepEqual(JSON.parse(seen[0]!.body!), { token: "123456789:AAEexample" });
    const info = await daemon.channels(port);
    assert.equal(info.telegram.tokenSet, true);
});

test("daemon: erro do daemon vira Error com a mensagem dele (sem ecoar o corpo enviado)", async () => {
    mode = "fail";
    try {
        await assert.rejects(daemon.setTelegramToken(port, "SEGREDO-123456789:AAEexample"), (err: Error) => {
            assert.equal(err.message, "token recusado");
            assert.ok(!err.message.includes("SEGREDO"));
            return true;
        });
    } finally {
        mode = "ok";
    }
});

test("daemon: sem token local ou sem daemon escutando → DaemonUnavailableError", async () => {
    await assert.rejects(daemon.channels(1), DaemonUnavailableError);
    fs.rmSync(path.join(dir, "local-token"));
    await assert.rejects(daemon.channels(port), (err: Error) => err instanceof DaemonUnavailableError && /token local/.test(err.message));
    fs.writeFileSync(path.join(dir, "local-token"), TOKEN, { mode: 0o600 });
});
