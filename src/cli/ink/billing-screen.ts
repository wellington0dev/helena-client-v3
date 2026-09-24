import React from "react";
import { Box, Text, useInput } from "ink";
import qrcodeTerminal from "qrcode-terminal";
import { cancelPendingPurchase, getBillingBalance, MAX_PURCHASE_BRL, MIN_PURCHASE_BRL, purchaseCredits, setDefaultContactLimit, type BillingBalance, type PurchaseResult } from "../api/billing.ts";
import { formatMoney, parseBrlInput } from "./format-money.ts";
import { UnauthorizedError } from "../backend.ts";
import { Form } from "./form.ts";
import { Loader } from "./loader.ts";
import { theme, panel, SPACE } from "./theme.ts";

const h = React.createElement;

function renderQrAscii(text: string): string {
    let ascii = "";
    qrcodeTerminal.generate(text, { small: true }, (output: string) => {
        ascii = output;
    });
    return ascii;
}


type ScreenState = { kind: "balance" } | { kind: "form" } | { kind: "limit" };

/** `/cobranca` — créditos em R$ da plataforma + comprar/cancelar. Só sobre `billing.controller.ts` (saldo que o dono consome) — nada a ver com `payments.controller.ts` (gateway do dono pra cobrar os PRÓPRIOS contatos), sem equivalente na CLI hoje. */
export function BillingScreen(props: { backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized } = props;
    const [balance, setBalance] = React.useState<BillingBalance | undefined>(undefined);
    const [purchaseResult, setPurchaseResult] = React.useState<PurchaseResult | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [screen, setScreen] = React.useState<ScreenState>({ kind: "balance" });

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) {
            onUnauthorized();
            return;
        }
        setError(err instanceof Error ? err.message : String(err));
    }

    const reload = React.useCallback(async () => {
        try {
            setBalance(await getBillingBalance(backendUrl, token));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    useInput((input, key) => {
        if (screen.kind !== "balance" || busy) return;
        if (key.escape) {
            onExit();
            return;
        }
        if (!balance?.hasPendingPayment && key.return) {
            setScreen({ kind: "form" });
            return;
        }
        if (input === "l") {
            setScreen({ kind: "limit" });
            return;
        }
        if (balance?.hasPendingPayment && input === "c") {
            void handleCancel();
        }
    });

    async function handleCancel(): Promise<void> {
        setBusy(true);
        setError(undefined);
        try {
            await cancelPendingPurchase(backendUrl, token);
            setPurchaseResult(undefined);
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleLimitSubmit(values: Record<string, string>): Promise<void> {
        const limit = parseBrlInput(values.limit);
        if (limit === undefined || limit === null) {
            setError("Valor inválido — use algo como 1 ou 2,50.");
            return;
        }
        setBusy(true);
        setError(undefined);
        try {
            await setDefaultContactLimit(backendUrl, token, limit);
            await reload();
            setScreen({ kind: "balance" });
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleSubmit(values: Record<string, string>): Promise<void> {
        // Aceita "20", "20,50" ou "R$ 20,50" — vírgula decimal (padrão BR) vira ponto.
        const valueBrl = Number((values.valueBrl ?? "").replace(/[R$\s.]/g, "").replace(",", "."));
        const cpfCnpj = (values.cpfCnpj ?? "").replace(/\D/g, "");
        if (!Number.isFinite(valueBrl) || valueBrl < MIN_PURCHASE_BRL || valueBrl > MAX_PURCHASE_BRL) {
            setError(`Valor precisa estar entre ${formatMoney(MIN_PURCHASE_BRL)} e ${formatMoney(MAX_PURCHASE_BRL)}.`);
            return;
        }
        if (cpfCnpj.length < 11) {
            setError("CPF/CNPJ precisa ter pelo menos 11 dígitos.");
            return;
        }
        setBusy(true);
        setError(undefined);
        try {
            const result = await purchaseCredits(backendUrl, token, Math.round(valueBrl * 100) / 100, cpfCnpj);
            setPurchaseResult(result);
            setScreen({ kind: "balance" });
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (!balance) return h(Loader, { text: "Carregando saldo..." });

    if (screen.kind === "limit") {
        return h(Form, {
            title: "Limite mensal padrão por contato/grupo",
            fields: [{ key: "limit", label: "Em R$ — quanto cada contato/grupo de terceiros pode gastar por mês (0 = nada até ganhar limite próprio)", initialValue: balance.defaultContactMonthlyLimitBrl.toFixed(2).replace(".", ",") }],
            onSubmit: (values) => void handleLimitSubmit(values),
            onCancel: () => setScreen({ kind: "balance" }),
            busy,
            error,
        });
    }

    if (screen.kind === "form") {
        return h(Form, {
            title: "Comprar créditos",
            fields: [
                { key: "valueBrl", label: `Valor em R$ (${formatMoney(MIN_PURCHASE_BRL)} a ${formatMoney(MAX_PURCHASE_BRL)})`, initialValue: "20" },
                { key: "cpfCnpj", label: "CPF/CNPJ (só dígitos)" },
            ],
            onSubmit: (values) => void handleSubmit(values),
            onCancel: () => setScreen({ kind: "balance" }),
            busy,
            error,
        });
    }

    return h(
        Box,
        { flexDirection: "column", ...panel("border") },
        h(Text, { bold: true, color: theme.primary }, "Cobrança — créditos"),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, { color: balance.creditBrl <= 0 ? theme.warning : undefined }, `Saldo atual: ${formatMoney(balance.creditBrl)}`),
        h(Text, { color: theme.textMuted }, `Cortesia recebida: ${formatMoney(balance.totalGrantedBrl)} · Total comprado: ${formatMoney(balance.totalPurchasedBrl)}`),
        h(Text, { color: theme.textMuted }, "Cada mensagem desconta o custo real da IA + 10%. O gasto por mensagem aparece na barra lateral."),
        h(Text, { color: theme.textMuted }, `Limite padrão por contato/grupo de terceiros: ${formatMoney(balance.defaultContactMonthlyLimitBrl)}/mês (l muda; por contato, em /contatos)`),
        h(Box, { marginTop: SPACE.tight }),
        error ? h(Text, { color: theme.danger }, `Erro: ${error}`) : null,
        balance.hasPendingPayment ? h(PendingPurchaseView, { balance, purchaseResult }) : null,
        h(Box, { marginTop: SPACE.tight }),
        h(
            Text,
            { color: theme.textMuted },
            busy ? "aplicando..." : balance.hasPendingPayment ? "c cancela a cobrança pendente · l limite por contato · Esc volta" : "Enter compra créditos · l limite por contato · Esc volta",
        ),
    );
}

function PendingPurchaseView(props: { balance: BillingBalance; purchaseResult: PurchaseResult | undefined }): React.ReactElement {
    const { balance, purchaseResult } = props;
    return h(
        Box,
        { flexDirection: "column", marginTop: SPACE.tight, ...panel("warning") },
        h(Text, { bold: true, color: theme.warning }, `Cobrança pendente — ${balance.pendingPurchaseBrl ? formatMoney(balance.pendingPurchaseBrl) : "aguardando pagamento"}`),
        purchaseResult?.pixPayload
            ? h(Box, { flexDirection: "column", marginTop: SPACE.tight }, h(Text, { color: theme.textMuted }, "PIX (escaneie ou copie o código abaixo):"), h(Text, null, renderQrAscii(purchaseResult.pixPayload)))
            : null,
        purchaseResult?.invoiceUrl
            ? h(Box, { flexDirection: "column", marginTop: SPACE.tight }, h(Text, { color: theme.textMuted }, "Ou pague por este link (cartão/boleto/PIX):"), h(Text, null, purchaseResult.invoiceUrl))
            : h(Box, { marginTop: SPACE.tight }, h(Text, { color: theme.textMuted }, "Gerada numa sessão anterior — sem QR/link aqui pra reexibir. Cancele e gere uma nova se precisar.")),
    );
}
