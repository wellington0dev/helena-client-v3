import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

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
    /** PIX copia-e-cola — pode faltar se a Asaas ainda não gerou o QR pra esta cobrança. */
    pixPayload?: string;
    /** Página hospedada pela própria Asaas — caminho garantido (PIX/cartão/boleto), sempre exibir com destaque. */
    invoiceUrl: string;
}

@Injectable({ providedIn: "root" })
export class BillingService {
    private readonly http = inject(HttpClient);

    balance(): Promise<BillingBalance> {
        return firstValueFrom(this.http.get<BillingBalance>("/billing/balance"));
    }

    purchase(tokens: number, cpfCnpj: string): Promise<PurchaseResult> {
        return firstValueFrom(this.http.post<PurchaseResult>("/billing/purchase", { tokens, cpfCnpj }));
    }

    async cancelPending(): Promise<boolean> {
        const res = await firstValueFrom(this.http.post<{ cancelled: boolean }>("/billing/purchase/cancel", {}));
        return res.cancelled;
    }
}
