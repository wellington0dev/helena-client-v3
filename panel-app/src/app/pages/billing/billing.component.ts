import { HttpErrorResponse } from "@angular/common/http";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import QRCode from "qrcode";
import type { BillingBalance } from "../../core/billing.service";
import { BillingService } from "../../core/billing.service";

function fmtNum(n: number | null | undefined): string {
    return (n ?? 0).toLocaleString("pt-BR");
}

/** `err instanceof Error` sozinho pega a mensagem GENÉRICA do Angular ("Http failure response for .../billing/purchase: 400 Bad Request"), nunca a mensagem real do backend (`{message: "..."}` no corpo) — bug real corrigido: erro de verdade (ex: "valor mínimo é R$5,00") nunca chegava na tela, só um texto inútil. */
function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse && typeof err.error?.message === "string") return err.error.message;
    return err instanceof Error ? err.message : fallback;
}

/** Saldo de tokens da plataforma, compra (PIX/cartão/boleto via Asaas) e cancelamento de compra pendente. */
@Component({
    selector: "app-billing",
    imports: [FormsModule],
    templateUrl: "./billing.component.html",
    styleUrl: "./billing.component.css",
})
export class BillingComponent {
    private readonly billingService = inject(BillingService);

    protected readonly balance = signal<BillingBalance | null>(null);
    protected readonly balanceLoading = signal(true);

    /** 3.000.000 no preço atual (TOKEN_PRICE_BRL_PER_MILLION=2) dá R$ 6,00 — acima do mínimo de R$ 5,00 exigido pela Asaas (ver platform-billing.service.ts#MIN_CHARGE_VALUE_BRL). O preset antigo ("500") arredondava pra R$ 0,00 e a Asaas rejeitava a cobrança sem explicar o motivo real — bug real corrigido. */
    protected purchaseTokens = "3000000";
    protected purchaseCpf = "";
    protected readonly purchaseError = signal("");
    protected readonly purchaseBusy = signal(false);

    protected readonly pixPayload = signal("");
    protected readonly pixQrDataUrl = signal("");
    protected readonly invoiceUrl = signal("");
    protected readonly copyPixLabel = signal("Copiar código");

    protected readonly balanceLabel = computed(() => fmtNum(this.balance()?.balance));
    protected readonly totalGrantedLabel = computed(() => fmtNum(this.balance()?.totalGranted));
    protected readonly totalPurchasedLabel = computed(() => fmtNum(this.balance()?.totalPurchased));
    protected readonly pendingTokensLabel = computed(() => fmtNum(this.balance()?.pendingPurchaseTokens));
    protected readonly balanceZero = computed(() => this.balance()?.balance === 0);
    protected readonly hasPendingPayment = computed(() => !!this.balance()?.hasPendingPayment);
    protected readonly showPurchaseForm = computed(() => !this.balance()?.hasPendingPayment);
    protected readonly pixQrPending = computed(() => !!this.pixPayload() && !this.pixQrDataUrl());

    constructor() {
        void this.loadBalance();
    }

    private async loadBalance(): Promise<void> {
        this.balanceLoading.set(true);
        try {
            const balance = await this.billingService.balance();
            this.balance.set(balance);
            if (!balance.hasPendingPayment) {
                this.pixPayload.set("");
                this.pixQrDataUrl.set("");
                this.invoiceUrl.set("");
            }
        } finally {
            this.balanceLoading.set(false);
        }
    }

    async submitPurchase(): Promise<void> {
        const tokens = parseInt(this.purchaseTokens, 10);
        const cpfCnpj = this.purchaseCpf.trim();
        if (!tokens || tokens < 1) {
            this.purchaseError.set("Informe uma quantidade válida de tokens.");
            return;
        }
        if (cpfCnpj.length < 11) {
            this.purchaseError.set("CPF/CNPJ inválido.");
            return;
        }
        this.purchaseBusy.set(true);
        this.purchaseError.set("");
        try {
            const res = await this.billingService.purchase(tokens, cpfCnpj);
            this.pixPayload.set(res.pixPayload || "");
            this.invoiceUrl.set(res.invoiceUrl);
            this.pixQrDataUrl.set("");
            if (res.pixPayload) {
                QRCode.toDataURL(res.pixPayload)
                    .then((url) => this.pixQrDataUrl.set(url))
                    .catch(() => {});
            }
            await this.loadBalance();
        } catch (err) {
            this.purchaseError.set(extractErrorMessage(err, "Falha ao gerar cobrança."));
        } finally {
            this.purchaseBusy.set(false);
        }
    }

    async cancelPending(): Promise<void> {
        await this.billingService.cancelPending();
        this.pixPayload.set("");
        this.pixQrDataUrl.set("");
        this.invoiceUrl.set("");
        await this.loadBalance();
    }

    copyPix(): void {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(this.pixPayload()).catch(() => {});
        }
        this.copyPixLabel.set("Copiado!");
        setTimeout(() => this.copyPixLabel.set("Copiar código"), 1800);
    }
}
