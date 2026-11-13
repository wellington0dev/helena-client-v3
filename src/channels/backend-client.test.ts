import { test, after } from "node:test";
import assert from "node:assert/strict";
import { fetchPendingOutbound, sendGroupInboundMessage, sendInboundMessage } from "./backend-client.ts";
import { configureBackendSession } from "../backend-session.ts";

const originalFetch = globalThis.fetch;
after(() => {
    globalThis.fetch = originalFetch;
});

function useSessionFetch(): void {
    configureBackendSession((path, init = {}) => globalThis.fetch(`http://127.0.0.1:3001${path}`, {
        ...init,
        headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: "Bearer jwt-session" },
    }));
}

test("sendInboundMessage: delega autenticação à sessão e manda o payload certo", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ sessionId: "abc", text: "oi" }), { status: 201 });
    }) as typeof fetch;
    useSessionFetch();

    const result = await sendInboundMessage({
        channel: "whatsapp",
        contactId: "5521999999999",
        senderName: "Fulano",
        text: "oi",
    });

    assert.equal(capturedUrl, "http://127.0.0.1:3001/channels/inbound");
    assert.equal((capturedInit?.headers as Record<string, string>)?.Authorization, "Bearer jwt-session");
    assert.deepEqual(JSON.parse(capturedInit?.body as string), { channel: "whatsapp", contactId: "5521999999999", senderName: "Fulano", text: "oi" });
    assert.deepEqual(result, { sessionId: "abc", text: "oi" });
});

test("sendInboundMessage: preserva o payload de áudio multimodal", async () => {
    let capturedBody: unknown;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ sessionId: "audio-session", text: "ouvi" }), { status: 200 });
    }) as typeof fetch;
    useSessionFetch();

    await sendInboundMessage({
        channel: "telegram",
        contactId: "42",
        text: "o que eu disse?",
        audio: { mimeType: "audio/ogg", base64: "YXVkaW8=" },
    });

    assert.deepEqual(capturedBody, { channel: "telegram", contactId: "42", text: "o que eu disse?", audio: { mimeType: "audio/ogg", base64: "YXVkaW8=" } });
});

test("sendInboundMessage: resposta {blocked:true} (rate limit) chega como está, sem lançar", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ blocked: true }), { status: 201 })) as typeof fetch;
    useSessionFetch();

    const result = await sendInboundMessage({ channel: "telegram", contactId: "123", text: "oi" });

    assert.deepEqual(result, { blocked: true });
});

test("sendInboundMessage: resposta não-ok (401/500/etc) lança com o status no erro", async () => {
    globalThis.fetch = (async () => new Response("Token de API inválido.", { status: 401 })) as typeof fetch;
    useSessionFetch();

    await assert.rejects(
        () => sendInboundMessage({ channel: "whatsapp", contactId: "1", text: "oi" }),
        (err: Error) => err.message.includes("401"),
    );
});

test("fetchPendingOutbound: usa sessão e devolve lista, não o objeto wrapper", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ messages: [{ id: "1", channel: "whatsapp", contactId: "5521999999999", text: "lembrete" }] }), { status: 200 });
    }) as typeof fetch;
    useSessionFetch();

    const messages = await fetchPendingOutbound();

    assert.equal(capturedUrl, "http://127.0.0.1:3001/channels/pending-outbound");
    assert.equal((capturedInit?.headers as Record<string, string>)?.Authorization, "Bearer jwt-session");
    assert.deepEqual(messages, [{ id: "1", channel: "whatsapp", contactId: "5521999999999", text: "lembrete" }]);
});

test("fetchPendingOutbound: resposta não-ok lança com o status no erro", async () => {
    globalThis.fetch = (async () => new Response("Token de API inválido.", { status: 401 })) as typeof fetch;
    useSessionFetch();

    await assert.rejects(() => fetchPendingOutbound(), (err: Error) => err.message.includes("401"));
});

test("sendGroupInboundMessage: manda pro endpoint certo com o payload de grupo (mentioned incluído)", async () => {
    let capturedUrl: string | undefined;
    let capturedBody: unknown;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = JSON.parse(init?.body as string);
        return new Response(JSON.stringify({ noReply: true }), { status: 201 });
    }) as typeof fetch;
    useSessionFetch();

    const result = await sendGroupInboundMessage({
        channel: "whatsapp",
        groupId: "120363111@g.us",
        groupName: "Amigos do Trampo",
        senderName: "Fulano",
        text: "oi pessoal",
        mentioned: false,
    });

    assert.equal(capturedUrl, "http://127.0.0.1:3001/channels/group-inbound");
    assert.deepEqual(capturedBody, {
        channel: "whatsapp",
        groupId: "120363111@g.us",
        groupName: "Amigos do Trampo",
        senderName: "Fulano",
        text: "oi pessoal",
        mentioned: false,
    });
    assert.deepEqual(result, { noReply: true });
});
