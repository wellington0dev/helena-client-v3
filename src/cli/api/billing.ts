import { authed } from "./http.ts";

/**
 * Créditos em R$ da PLATAFORMA que a Helena consome (desde 2026-09-24 — antes era saldo em tokens). Cada mensagem
 * desconta o custo real do modelo × 1,1. Não confundir com `payments` (conta Asaas que o PRÓPRIO dono conecta pra
 * cobrar os contatos dele; não tem equivalente na CLI hoje). Ver
 * `backend-v2/docs/rest-api-reference.md#cobrança-da-plataforma-billing`.
 */
export interface BillingBalance {
    creditBrl: number;
    totalGrantedBrl: number;
    totalPurchasedBrl: number;
    pendingPurchaseBrl: number | null;
    hasPendingPayment: boolean;
}

export interface PurchaseResult {
    paymentId: string;
    valueBrl: number;
    /** Texto copia-e-cola do PIX — pode faltar (ex: cliente escolheu cartão na página hospedada). */
    pixPayload?: string;
    invoiceUrl: string;
}

/** Limites validados pelo backend (PlatformBillingService#purchase) — repetidos aqui só pra avisar antes de chamar. */
export const MIN_PURCHASE_BRL = 5;
export const MAX_PURCHASE_BRL = 1000;

export function getBillingBalance(baseUrl: string, token: string): Promise<BillingBalance> {
    return authed(baseUrl, token, "GET", "/billing/balance");
}

export function purchaseCredits(baseUrl: string, token: string, valueBrl: number, cpfCnpj: string): Promise<PurchaseResult> {
    return authed(baseUrl, token, "POST", "/billing/purchase", { valueBrl, cpfCnpj });
}

export function cancelPendingPurchase(baseUrl: string, token: string): Promise<{ cancelled: boolean }> {
    return authed(baseUrl, token, "POST", "/billing/purchase/cancel");
}
