import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteContact, getContact, getContactHistory, listContacts, updateContact } from "./contacts.ts";

const originalFetch = globalThis.fetch;
function restoreFetch(): void {
    globalThis.fetch = originalFetch;
}

test("listContacts: GET /contacts", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify([{ id: "c1", channel: "whatsapp", contactId: "5511999999999" }]), { status: 200 });
    }) as typeof fetch;

    try {
        const contacts = await listContacts("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/contacts");
        assert.equal(contacts.length, 1);
        assert.equal(contacts[0]?.id, "c1");
    } finally {
        restoreFetch();
    }
});

test("getContact: GET /contacts/:id, 404 extrai a mensagem do corpo", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Contato não encontrado." }), { status: 404 })) as typeof fetch;

    try {
        await assert.rejects(() => getContact("http://127.0.0.1:4001", "jwt-fake", "inexistente"), (err: Error) => {
            assert.equal(err.message, "Contato não encontrado.");
            return true;
        });
    } finally {
        restoreFetch();
    }
});

test("getContactHistory: monta querystring de limit/offset só quando presentes", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ entries: [], total: 0 }), { status: 200 });
    }) as typeof fetch;

    try {
        await getContactHistory("http://127.0.0.1:4001", "jwt-fake", "c1", 20, 40);
        assert.equal(capturedUrl, "http://127.0.0.1:4001/contacts/c1/history?limit=20&offset=40");

        await getContactHistory("http://127.0.0.1:4001", "jwt-fake", "c1");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/contacts/c1/history");
    } finally {
        restoreFetch();
    }
});

test("updateContact: PATCH com o patch parcial no body", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ id: "c1", channel: "whatsapp", contactId: "x", name: "Novo nome" }), { status: 200 });
    }) as typeof fetch;

    try {
        await updateContact("http://127.0.0.1:4001", "jwt-fake", "c1", { name: "Novo nome", grantedTools: ["notes"] });
        assert.equal(capturedInit?.method, "PATCH");
        assert.deepEqual(JSON.parse(capturedInit?.body as string), { name: "Novo nome", grantedTools: ["notes"] });
    } finally {
        restoreFetch();
    }
});

test("deleteContact: DELETE /contacts/:id", async () => {
    let capturedUrl: string | undefined;
    let capturedMethod: string | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
    }) as typeof fetch;

    try {
        const result = await deleteContact("http://127.0.0.1:4001", "jwt-fake", "c1");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/contacts/c1");
        assert.equal(capturedMethod, "DELETE");
        assert.deepEqual(result, { deleted: true });
    } finally {
        restoreFetch();
    }
});
