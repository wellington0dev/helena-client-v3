import { test, after } from "node:test";
import assert from "node:assert/strict";
import { authed, parseOrThrow, UnauthorizedError } from "./http.ts";

const originalFetch = globalThis.fetch;
after(() => {
    globalThis.fetch = originalFetch;
});

test("parseOrThrow: 400 com {message: string} extrai a mensagem real, não o corpo cru inteiro", async () => {
    const response = new Response(JSON.stringify({ message: "valor mínimo é R$5,00" }), { status: 400 });
    await assert.rejects(() => parseOrThrow(response), (err: Error) => {
        assert.equal(err.message, "valor mínimo é R$5,00");
        return true;
    });
});

test("parseOrThrow: 400 com {message: string[]} junta as mensagens", async () => {
    const response = new Response(JSON.stringify({ message: ["campo X inválido", "campo Y inválido"] }), { status: 400 });
    await assert.rejects(() => parseOrThrow(response), (err: Error) => {
        assert.equal(err.message, "campo X inválido — campo Y inválido");
        return true;
    });
});

test("parseOrThrow: 401 lança UnauthorizedError com a mensagem extraída (não mais um texto genérico)", async () => {
    const response = new Response(JSON.stringify({ message: "sessão expirada" }), { status: 401 });
    await assert.rejects(() => parseOrThrow(response), (err: unknown) => {
        assert.ok(err instanceof UnauthorizedError);
        assert.equal((err as Error).message, "sessão expirada");
        return true;
    });
});

test("parseOrThrow: corpo não-JSON cai no texto cru", async () => {
    const response = new Response("Internal Server Error", { status: 500 });
    await assert.rejects(() => parseOrThrow(response), (err: Error) => {
        assert.equal(err.message, "Internal Server Error");
        return true;
    });
});

test("parseOrThrow: resposta ok devolve o JSON parseado", async () => {
    const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
    const result = await parseOrThrow<{ ok: boolean }>(response);
    assert.deepEqual(result, { ok: true });
});

test("authed: manda método/Authorization/body corretos", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    await authed("http://127.0.0.1:4001", "jwt-fake", "PATCH", "/auth/me/telemetry-consent", { consent: true });

    assert.equal(capturedUrl, "http://127.0.0.1:4001/auth/me/telemetry-consent");
    assert.equal(capturedInit?.method, "PATCH");
    assert.equal((capturedInit?.headers as Record<string, string>).Authorization, "Bearer jwt-fake");
    assert.deepEqual(JSON.parse(capturedInit?.body as string), { consent: true });
});

test("authed: sem body (GET) não manda chave `body` nenhuma", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    await authed("http://127.0.0.1:4001", "jwt-fake", "GET", "/auth/api-tokens");

    assert.equal(capturedInit?.body, undefined);
});
