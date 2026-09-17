import { authed } from "./http.ts";

/**
 * Saldo de tokens da PLATAFORMA que a Helena consome — não confundir com
 * `payments` (conta Asaas que o PRÓPRIO dono conecta pra cobrar os
 * contatos dele; não tem equivalente na CLI hoje). Ver
 * `backend-v2/docs/rest-api-reference.md#cobrança-da-plataforma-billing`.
 */
export interface BillingBalance {
    balance: number;
    totalGranted: number;
    totalPurchased: number;
    pendingPurchaseTokens: number | null;
    hasPendingPayment: boolean;
}

export interface PurchaseResult {
    paymentId: string;
    tokens: number;
    valueBrl: number;
    /** Texto copia-e-cola do PIX — pode faltar (ex: cliente escolheu cartão na página hospedada). */
    pixPayload?: string;
    invoiceUrl: string;
}

export function getBillingBalance(baseUrl: string, token: string): Promise<BillingBalance> {
    return authed(baseUrl, token, "GET", "/billing/balance");
}

export function purchaseTokens(baseUrl: string, token: string, tokens: number, cpfCnpj: string): Promise<PurchaseResult> {
    return authed(baseUrl, token, "POST", "/billing/purchase", { tokens, cpfCnpj });
}

export function cancelPendingPurchase(baseUrl: string, token: string): Promise<{ cancelled: boolean }> {
    return authed(baseUrl, token, "POST", "/billing/purchase/cancel");
}
