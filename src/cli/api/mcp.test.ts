import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpConnection, deleteMcpConnection, listMcpConnections, updateMcpConnection } from "./mcp.ts";

const originalFetch = globalThis.fetch;
function restoreFetch(): void {
    globalThis.fetch = originalFetch;
}

test("listMcpConnections: GET /mcp-connections", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify([{ id: "m1", name: "estoque", serverUrl: "http://x", hasAuthToken: true, enabled: true }]), { status: 200 });
    }) as typeof fetch;

    try {
        const conns = await listMcpConnections("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/mcp-connections");
        assert.equal(conns[0]?.name, "estoque");
    } finally {
        restoreFetch();
    }
});

test("createMcpConnection: POST com o body correto", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ id: "m1", name: "estoque", serverUrl: "http://x", hasAuthToken: false, enabled: true }), { status: 201 });
    }) as typeof fetch;

    try {
        await createMcpConnection("http://127.0.0.1:4001", "jwt-fake", { name: "estoque", serverUrl: "http://x", enabled: true });
        assert.equal(capturedInit?.method, "POST");
        assert.deepEqual(JSON.parse(capturedInit?.body as string), { name: "estoque", serverUrl: "http://x", enabled: true });
    } finally {
        restoreFetch();
    }
});

test("createMcpConnection: 409 (nome duplicado) extrai a mensagem do corpo", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Já existe uma conexão com esse nome." }), { status: 409 })) as typeof fetch;

    try {
        await assert.rejects(() => createMcpConnection("http://127.0.0.1:4001", "jwt-fake", { name: "estoque", serverUrl: "http://x" }), (err: Error) => {
            assert.equal(err.message, "Já existe uma conexão com esse nome.");
            return true;
        });
    } finally {
        restoreFetch();
    }
});

test("updateMcpConnection: PATCH sem authToken não manda essa chave", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ id: "m1", name: "novo nome", serverUrl: "http://x", hasAuthToken: true, enabled: true }), { status: 200 });
    }) as typeof fetch;

    try {
        await updateMcpConnection("http://127.0.0.1:4001", "jwt-fake", "m1", { name: "novo nome" });
        assert.deepEqual(JSON.parse(capturedInit?.body as string), { name: "novo nome" });
    } finally {
        restoreFetch();
    }
});

test("deleteMcpConnection: DELETE /mcp-connections/:id", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }) as typeof fetch;

    try {
        await deleteMcpConnection("http://127.0.0.1:4001", "jwt-fake", "m1");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/mcp-connections/m1");
        assert.equal(capturedMethod, "DELETE");
    } finally {
        restoreFetch();
    }
});
