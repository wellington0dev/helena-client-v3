import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_ROLES, DEFAULT_AGENT_NAMES, listAgentPersonas, resetAgentPersona, setAgentPersonaName } from "./agent-personas.ts";

const originalFetch = globalThis.fetch;
function restoreFetch(): void {
    globalThis.fetch = originalFetch;
}

test("AGENT_ROLES/DEFAULT_AGENT_NAMES: 7 papéis clássicos, cada um com nome padrão", () => {
    assert.equal(AGENT_ROLES.length, 7);
    for (const role of AGENT_ROLES) assert.ok(DEFAULT_AGENT_NAMES[role]);
});

test("listAgentPersonas: GET /agent-personas", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ architect: "Ada" }), { status: 200 });
    }) as typeof fetch;
    try {
        const personas = await listAgentPersonas("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/agent-personas");
        assert.equal(personas.architect, "Ada");
    } finally {
        restoreFetch();
    }
});

test("setAgentPersonaName: PATCH /agent-personas/:role com {name}", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response(JSON.stringify({ architect: "Nova" }), { status: 200 });
    }) as typeof fetch;
    try {
        await setAgentPersonaName("http://127.0.0.1:4001", "jwt-fake", "architect", "Nova");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/agent-personas/architect");
        assert.deepEqual(JSON.parse(capturedInit?.body as string), { name: "Nova" });
    } finally {
        restoreFetch();
    }
});

test("resetAgentPersona: DELETE /agent-personas/:role", async () => {
    let capturedMethod: string | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedMethod = init?.method;
        return new Response(JSON.stringify({ architect: "Ada" }), { status: 200 });
    }) as typeof fetch;
    try {
        await resetAgentPersona("http://127.0.0.1:4001", "jwt-fake", "architect");
        assert.equal(capturedMethod, "DELETE");
    } finally {
        restoreFetch();
    }
});
