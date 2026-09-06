import { test, after } from "node:test";
import assert from "node:assert/strict";
import { login, resolveInterrupt, sendMessage, UnauthorizedError } from "./backend.ts";

const originalFetch = globalThis.fetch;
after(() => {
    globalThis.fetch = originalFetch;
});

test("login: manda email/senha pro /auth/login e devolve o accessToken", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ accessToken: "jwt-fake" }), { status: 201 });
    }) as typeof fetch;

    const token = await login("http://127.0.0.1:4001", "dono@example.com", "senha123");

    assert.equal(capturedUrl, "http://127.0.0.1:4001/auth/login");
    assert.deepEqual(capturedBody, { email: "dono@example.com", password: "senha123" });
    assert.equal(token, "jwt-fake");
});

test("login: credenciais erradas (401) lança UnauthorizedError", async () => {
    globalThis.fetch = (async () => new Response("Credenciais inválidas.", { status: 401 })) as typeof fetch;

    await assert.rejects(() => login("http://127.0.0.1:4001", "dono@example.com", "errada"), UnauthorizedError);
});

test("sendMessage: manda Authorization Bearer + cwd/machineName no body", async () => {
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ sessionId: "s1", text: "oi" }), { status: 201 });
    }) as typeof fetch;

    const result = await sendMessage("http://127.0.0.1:4001", "jwt-fake", { text: "lista os arquivos", cwd: "/home/dono/projeto", machineName: "notebook" });

    assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer jwt-fake");
    assert.deepEqual(JSON.parse(capturedInit?.body as string), { text: "lista os arquivos", cwd: "/home/dono/projeto", machineName: "notebook" });
    assert.deepEqual(result, { sessionId: "s1", text: "oi" });
});

test("sendMessage: token expirado (401) lança UnauthorizedError (chat.ts usa isso pra relogar)", async () => {
    globalThis.fetch = (async () => new Response("Token expirado.", { status: 401 })) as typeof fetch;

    await assert.rejects(() => sendMessage("http://127.0.0.1:4001", "jwt-velho", { text: "oi" }), UnauthorizedError);
});

test("resolveInterrupt: manda tool/ref/approved/reason pro endpoint certo", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ sessionId: "s1", text: "feito" }), { status: 201 });
    }) as typeof fetch;

    await resolveInterrupt("http://127.0.0.1:4001", "jwt-fake", "s1", "shell", undefined, true);

    assert.equal(capturedUrl, "http://127.0.0.1:4001/chat/sessions/s1/resolve");
    // ref/reason ausentes na chamada viram `undefined` no objeto — JSON.stringify
    // OMITE essas chaves (não vira `null`), então nem aparecem no body real.
    assert.deepEqual(capturedBody, { tool: "shell", approved: true });
});
