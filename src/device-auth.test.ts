import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HOME isolado ANTES de importar config/device-token (device-token.json é calculado uma vez, no module-load) — mesmo motivo de session-store.test.ts.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-device-auth-test-"));
process.env.HOME = fakeHome;

const { config } = await import("./config.ts");
const { ensureDeviceToken, jwtSubject } = await import("./device-auth.ts");
const { saveDeviceToken, readStoredDeviceToken } = await import("./device-token.ts");

const noop = () => undefined;

/** JWT sem assinatura válida — ensureDeviceToken só lê o `sub`; quem valida é o backend. */
function fakeJwt(sub: string): string {
    return `x.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.y`;
}

function okProvisionFetch(token: string, calls: { auth?: string }[]): typeof fetch {
    return ((_url: string, init: RequestInit) => {
        calls.push({ auth: (init.headers as Record<string, string>).Authorization });
        return Promise.resolve(new Response(JSON.stringify({ token }), { status: 200 }));
    }) as unknown as typeof fetch;
}

test("ensureDeviceToken: token salvo é DESTA conta — nunca chama fetch, nunca sobrescreve", async () => {
    saveDeviceToken("token-do-dono", "user-dono");
    config.backendApiToken = "token-do-dono";
    config.backendUrl = "http://backend-fake.invalid";
    const originalFetch = global.fetch;
    let called = false;
    global.fetch = (() => {
        called = true;
        throw new Error("não deveria ter chamado fetch");
    }) as typeof fetch;

    try {
        await ensureDeviceToken(fakeJwt("user-dono"), noop);
        assert.equal(called, false);
        assert.equal(config.backendApiToken, "token-do-dono");
    } finally {
        global.fetch = originalFetch;
        config.backendApiToken = "";
    }
});

test("ensureDeviceToken: token de OUTRA conta (bug real: token do admin de seed no .env) — provisiona pra conta logada e grava o dono", async () => {
    saveDeviceToken("token-do-admin", "user-admin");
    config.backendApiToken = "token-do-admin";
    config.backendUrl = "http://backend-fake.invalid";
    const originalFetch = global.fetch;
    const calls: { auth?: string }[] = [];
    global.fetch = okProvisionFetch("token-novo-do-dono", calls);

    try {
        const jwt = fakeJwt("user-dono");
        await ensureDeviceToken(jwt, noop);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].auth, `Bearer ${jwt}`);
        assert.equal(config.backendApiToken, "token-novo-do-dono");
        assert.deepEqual(readStoredDeviceToken(), { token: "token-novo-do-dono", userId: "user-dono" });
    } finally {
        global.fetch = originalFetch;
        config.backendApiToken = "";
        config.backendUrl = "";
    }
});

test("ensureDeviceToken: token de dono desconhecido (.env, sem device-token.json com userId) — provisiona", async () => {
    fs.rmSync(path.join(fakeHome, ".config", "helena", "device-token.json"), { force: true });
    config.backendApiToken = "token-do-env";
    config.backendUrl = "http://backend-fake.invalid";
    const originalFetch = global.fetch;
    const calls: { auth?: string }[] = [];
    global.fetch = okProvisionFetch("token-provisionado", calls);

    try {
        await ensureDeviceToken(fakeJwt("user-dono"), noop);
        assert.equal(calls.length, 1);
        assert.equal(config.backendApiToken, "token-provisionado");
    } finally {
        global.fetch = originalFetch;
        config.backendApiToken = "";
        config.backendUrl = "";
    }
});

test("ensureDeviceToken: dois logins simultâneos provisionam UM token só", async () => {
    fs.rmSync(path.join(fakeHome, ".config", "helena", "device-token.json"), { force: true });
    config.backendApiToken = "";
    config.backendUrl = "http://backend-fake.invalid";
    const originalFetch = global.fetch;
    const calls: { auth?: string }[] = [];
    global.fetch = okProvisionFetch("token-unico", calls);

    try {
        await Promise.all([ensureDeviceToken(fakeJwt("user-dono"), noop), ensureDeviceToken(fakeJwt("user-dono"), noop)]);
        assert.equal(calls.length, 1);
    } finally {
        global.fetch = originalFetch;
        config.backendApiToken = "";
        config.backendUrl = "";
    }
});

test("jwtSubject: lê o sub; JWT malformado → undefined (e aí nunca provisiona)", () => {
    assert.equal(jwtSubject(fakeJwt("abc")), "abc");
    assert.equal(jwtSubject("lixo"), undefined);
    assert.equal(jwtSubject("a.b.c"), undefined);
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
        await ensureDeviceToken(fakeJwt("user-dono"), noop);
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
        await assert.doesNotReject(() => ensureDeviceToken(fakeJwt("user-dono"), noop));
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
        await assert.doesNotReject(() => ensureDeviceToken(fakeJwt("user-dono"), noop));
        assert.equal(config.backendApiToken, "");
    } finally {
        global.fetch = originalFetch;
    }
});
