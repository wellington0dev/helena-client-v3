import { test } from "node:test";
import assert from "node:assert/strict";
import { cancelPendingPurchase, getBillingBalance, purchaseCredits, setDefaultContactLimit } from "./billing.ts";

const originalFetch = globalThis.fetch;
function restoreFetch(): void {
    globalThis.fetch = originalFetch;
}

test("getBillingBalance: GET /billing/balance", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ creditBrl: 12.5, totalGrantedBrl: 1, totalPurchasedBrl: 20, pendingPurchaseBrl: null, hasPendingPayment: false, defaultContactMonthlyLimitBrl: 1 }), { status: 200 });
    }) as typeof fetch;

    try {
        const balance = await getBillingBalance("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/billing/balance");
        assert.equal(balance.creditBrl, 12.5);
    } finally {
        restoreFetch();
    }
});

test("purchaseCredits: POST com valueBrl/cpfCnpj no body (créditos em R$, não tokens)", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ paymentId: "p1", valueBrl: 20, pixPayload: "00020126...", invoiceUrl: "https://asaas.example/i/1" }), { status: 201 });
    }) as typeof fetch;

    try {
        const result = await purchaseCredits("http://127.0.0.1:4001", "jwt-fake", 20, "12345678900");
        assert.deepEqual(JSON.parse(capturedInit?.body as string), { valueBrl: 20, cpfCnpj: "12345678900" });
        assert.equal(result.invoiceUrl, "https://asaas.example/i/1");
    } finally {
        restoreFetch();
    }
});

test("purchaseCredits: 409 (cobrança pendente) extrai a mensagem real do corpo, não o JSON cru", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Já existe uma cobrança pendente." }), { status: 409 })) as typeof fetch;

    try {
        await assert.rejects(() => purchaseCredits("http://127.0.0.1:4001", "jwt-fake", 100, "12345678900"), (err: Error) => {
            assert.equal(err.message, "Já existe uma cobrança pendente.");
            return true;
        });
    } finally {
        restoreFetch();
    }
});

test("purchaseCredits: 400 (valor mínimo) extrai a mensagem real — bug real do painel que a CLI precisa evitar repetir", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ message: "valor mínimo é R$5,00" }), { status: 400 })) as typeof fetch;

    try {
        await assert.rejects(() => purchaseCredits("http://127.0.0.1:4001", "jwt-fake", 1, "12345678900"), (err: Error) => {
            assert.equal(err.message, "valor mínimo é R$5,00");
            return true;
        });
    } finally {
        restoreFetch();
    }
});

test("cancelPendingPurchase: POST /billing/purchase/cancel", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
    }) as typeof fetch;

    try {
        const result = await cancelPendingPurchase("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/billing/purchase/cancel");
        assert.deepEqual(result, { cancelled: true });
    } finally {
        restoreFetch();
    }
});

test("setDefaultContactLimit: PATCH /billing/contact-limit com o valor em R$", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        captured = { url, init };
        return new Response(JSON.stringify({ defaultMonthlyLimitBrl: 2.5 }), { status: 200 });
    }) as typeof fetch;
    try {
        await setDefaultContactLimit("http://127.0.0.1:4001", "jwt-fake", 2.5);
        assert.equal(captured.url, "http://127.0.0.1:4001/billing/contact-limit");
        assert.equal(captured.init?.method, "PATCH");
        assert.deepEqual(JSON.parse(captured.init?.body as string), { defaultMonthlyLimitBrl: 2.5 });
    } finally {
        restoreFetch();
    }
});
