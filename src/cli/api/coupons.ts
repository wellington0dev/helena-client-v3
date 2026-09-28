import { authed } from "./http.ts";

/**
 * Resgate de cupom de crédito (2026-09-28) — código curto "XXXX-XXXX" que credita `creditBrl` no mesmo saldo de
 * `billing.ts` (`PlatformTokenBalance`). Ver `backend-v2/src/coupons/`.
 */
export interface RedeemedCoupon {
    creditBrl: number;
    /** Escolhida pelo admin que criou o cupom — só é revelada AGORA, no resgate (nunca antes). */
    confirmationMessage: string;
    newBalanceBrl: number;
}

/** Cupom destinado a ESTE usuário (`assignedToUserId`), ainda não resgatado — `GET /coupons/pending`. */
export interface PendingCoupon {
    id: string;
    code: string;
    creditBrl: number;
    confirmationMessage: string;
    createdAt: string;
}

export function redeemCoupon(baseUrl: string, token: string, code: string): Promise<RedeemedCoupon> {
    return authed(baseUrl, token, "POST", "/coupons/redeem", { code });
}

export function getPendingCoupons(baseUrl: string, token: string): Promise<PendingCoupon[]> {
    return authed(baseUrl, token, "GET", "/coupons/pending");
}
