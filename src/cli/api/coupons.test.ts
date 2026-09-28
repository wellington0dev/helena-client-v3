import { test } from "node:test";
import assert from "node:assert/strict";
import { getPendingCoupons, redeemCoupon } from "./coupons.ts";

const originalFetch = globalThis.fetch;
function restoreFetch(): void {
    globalThis.fetch = originalFetch;
}

test("redeemCoupon: POST /coupons/redeem com o código no body", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        captured = { url, init };
        return new Response(JSON.stringify({ creditBrl: 37.5, confirmationMessage: "Cupom ativado!", newBalanceBrl: 38.5 }), { status: 201 });
    }) as typeof fetch;

    try {
        const result = await redeemCoupon("http://127.0.0.1:4001", "jwt-fake", "ABCD-1234");
        assert.equal(captured.url, "http://127.0.0.1:4001/coupons/redeem");
        assert.equal(captured.init?.method, "POST");
        assert.deepEqual(JSON.parse(captured.init?.body as string), { code: "ABCD-1234" });
        assert.deepEqual(result, { creditBrl: 37.5, confirmationMessage: "Cupom ativado!", newBalanceBrl: 38.5 });
    } finally {
        restoreFetch();
    }
});

test("redeemCoupon: 409 (já usado) extrai a mensagem real do corpo, não o JSON cru", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Este cupom já foi utilizado." }), { status: 409 })) as typeof fetch;

    try {
        await assert.rejects(() => redeemCoupon("http://127.0.0.1:4001", "jwt-fake", "ABCD-1234"), (err: Error) => {
            assert.equal(err.message, "Este cupom já foi utilizado.");
            return true;
        });
    } finally {
        restoreFetch();
    }
});

test("redeemCoupon: 404 (código inexistente) extrai a mensagem real", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Cupom não encontrado." }), { status: 404 })) as typeof fetch;

    try {
        await assert.rejects(() => redeemCoupon("http://127.0.0.1:4001", "jwt-fake", "ZZZZ-ZZZZ"), (err: Error) => {
            assert.equal(err.message, "Cupom não encontrado.");
            return true;
        });
    } finally {
        restoreFetch();
    }
});

test("getPendingCoupons: GET /coupons/pending", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify([{ id: "c1", code: "ABCD-1234", creditBrl: 10, confirmationMessage: "oi", createdAt: "2026-09-28T00:00:00.000Z" }]), { status: 200 });
    }) as typeof fetch;

    try {
        const coupons = await getPendingCoupons("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/coupons/pending");
        assert.equal(coupons.length, 1);
        assert.equal(coupons[0]?.code, "ABCD-1234");
    } finally {
        restoreFetch();
    }
});

test("getPendingCoupons: lista vazia quando não há cupons pendentes", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([]), { status: 200 })) as typeof fetch;

    try {
        assert.deepEqual(await getPendingCoupons("http://127.0.0.1:4001", "jwt-fake"), []);
    } finally {
        restoreFetch();
    }
});
