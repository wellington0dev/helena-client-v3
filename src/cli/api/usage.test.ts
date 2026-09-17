import { test } from "node:test";
import assert from "node:assert/strict";
import { getUsage } from "./usage.ts";

const originalFetch = globalThis.fetch;

test("getUsage: GET /dashboard/usage", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(
            JSON.stringify({ totalCalls: 10, callsByChannel: { whatsapp: 7, cli: 3 }, callsByDay: [{ date: "2026-09-15", calls: 10 }] }),
            { status: 200 },
        );
    }) as typeof fetch;

    try {
        const usage = await getUsage("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/dashboard/usage");
        assert.equal(usage.totalCalls, 10);
        assert.deepEqual(usage.callsByChannel, { whatsapp: 7, cli: 3 });
    } finally {
        globalThis.fetch = originalFetch;
    }
});
