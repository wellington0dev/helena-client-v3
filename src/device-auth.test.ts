import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HOME isolado ANTES de importar config/device-token (device-token.json é calculado uma vez, no module-load) — mesmo motivo de session-store.test.ts.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-device-auth-test-"));
process.env.HOME = fakeHome;

const { config } = await import("./config.ts");
const { ensureDeviceToken } = await import("./device-auth.ts");

test("ensureDeviceToken: já tem token configurado — nunca chama fetch, nunca sobrescreve", async () => {
    config.backendApiToken = "token-ja-existente";
    config.backendUrl = "http://backend-fake.invalid";
    const originalFetch = global.fetch;
    let called = false;
    global.fetch = (() => {
        called = true;
        throw new Error("não deveria ter chamado fetch");
    }) as typeof fetch;

    try {
        await ensureDeviceToken("algum-jwt");
        assert.equal(called, false);
        assert.equal(config.backendApiToken, "token-ja-existente");
    } finally {
        global.fetch = originalFetch;
        config.backendApiToken = "";
    }
});

test("ensureDeviceToken: sem backendUrl configurado — nunca chama fetch", async () => {
    config.backendApiToken = "";
    config.backendUrl = "";
    const originalFetch = global.fetch;
    let called = false;
    global.fetch = (() => {
        called = true;
        throw new Error("não deveria ter chamado fetch");
    }) as typeof fetch;

    try {
        await ensureDeviceToken("algum-jwt");
        assert.equal(called, false);
    } finally {
        global.fetch = originalFetch;
    }
});

test("ensureDeviceToken: fetch falha (rede/DNS) — nunca lança, config.backendApiToken continua vazio", async () => {
    config.backendApiToken = "";
    config.backendUrl = "http://backend-fake.invalid";
    const originalFetch = global.fetch;
    global.fetch = (() => Promise.reject(new Error("ENOTFOUND"))) as typeof fetch;

    try {
        await assert.doesNotReject(() => ensureDeviceToken("algum-jwt"));
        assert.equal(config.backendApiToken, "");
    } finally {
        global.fetch = originalFetch;
    }
});

test("ensureDeviceToken: backend devolve não-ok (401/500) — nunca lança, não seta o token", async () => {
    config.backendApiToken = "";
    config.backendUrl = "http://backend-fake.invalid";
    const originalFetch = global.fetch;
    global.fetch = (() => Promise.resolve(new Response(null, { status: 401 }))) as typeof fetch;

    try {
        await assert.doesNotReject(() => ensureDeviceToken("jwt-expirado"));
        assert.equal(config.backendApiToken, "");
    } finally {
        global.fetch = originalFetch;
    }
});
