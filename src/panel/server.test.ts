import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HOME isolado ANTES de importar session-store (via server.ts) — mesmo motivo de cli/session-store.test.ts: SESSION_PATH é calculado uma vez, no module-load.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-panel-server-test-"));
const originalHome = process.env.HOME;
process.env.HOME = fakeHome;

const { startPanelServer } = await import("./server.ts");
const { loadSession } = await import("../cli/session-store.ts");

const port = 41000 + Math.floor(Math.random() * 1000);
let server: ReturnType<typeof startPanelServer>;

before(() => {
    process.env.HOME = fakeHome;
    server = startPanelServer(port, "http://backend-fake.invalid");
});

after(async () => {
    // Sem fechar isto, o socket aberto prende o event loop — `node --test` nunca termina este arquivo (achado ao vivo: suíte inteira travou ~5min até o timeout do harness).
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env.HOME = originalHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
});

test("POST /cli-session com accessToken válido grava a MESMA session.json que o CLI lê", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/cli-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken: "jwt-do-painel" }),
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(loadSession(), { accessToken: "jwt-do-painel" });
});

test("POST /cli-session sem accessToken recusa com 400, sem gravar nada", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/cli-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { ok: false });
});

test("POST /cli-session com corpo inválido (não-JSON) recusa com 400, não derruba o servidor", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/cli-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "isso não é json",
    });

    assert.equal(res.status, 400);
});
