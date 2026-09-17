import React from "react";
import { Box, Text, useInput } from "ink";
import qrcodeTerminal from "qrcode-terminal";
import { cancelPendingPurchase, getBillingBalance, purchaseTokens, type BillingBalance, type PurchaseResult } from "../api/billing.ts";
import { UnauthorizedError } from "../backend.ts";
import { Form } from "./form.ts";
import { theme } from "./theme.ts";

const h = React.createElement;

function renderQrAscii(text: string): string {
    let ascii = "";
    qrcodeTerminal.generate(text, { small: true }, (output: string) => {
        ascii = output;
    });
    return ascii;
}

function fmtNum(n: number): string {
    return n.toLocaleString("pt-BR");
}

type ScreenState = { kind: "balance" } | { kind: "form" };

/** `/cobranca` — saldo de tokens da plataforma + comprar/cancelar. Só sobre `billing.controller.ts` (saldo que o dono consome) — nada a ver com `payments.controller.ts` (gateway do dono pra cobrar os PRÓPRIOS contatos), sem equivalente na CLI hoje. */
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

    async function handleSubmit(values: Record<string, string>): Promise<void> {
        const tokens = Number.parseInt(values.tokens ?? "", 10);
        const cpfCnpj = (values.cpfCnpj ?? "").replace(/\D/g, "");
        if (!Number.isFinite(tokens) || tokens < 1) {
            setError("Quantidade de tokens inválida.");
            return;
        }
        if (cpfCnpj.length < 11) {
            setError("CPF/CNPJ precisa ter pelo menos 11 dígitos.");
            return;
        }
        setBusy(true);
        setError(undefined);
        try {
            const result = await purchaseTokens(backendUrl, token, tokens, cpfCnpj);
            setPurchaseResult(result);
            setScreen({ kind: "balance" });
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (!balance) {
        return h(Text, { dimColor: true }, "Carregando saldo...");
    }

    if (screen.kind === "form") {
        return h(Form, {
            title: "Comprar tokens",
            fields: [
                { key: "tokens", label: "Quantidade de tokens", initialValue: "3000000" },
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
        { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
        h(Text, { bold: true, color: theme.primary }, "Cobrança — saldo de tokens"),
        h(Box, { marginTop: 1 }),
        h(Text, null, `Saldo atual: ${fmtNum(balance.balance)} tokens`),
        h(Text, { dimColor: true }, `Total recebido: ${fmtNum(balance.totalGranted)} · Total comprado: ${fmtNum(balance.totalPurchased)}`),
        h(Box, { marginTop: 1 }),
        error ? h(Text, { color: theme.danger }, `Erro: ${error}`) : null,
        balance.hasPendingPayment ? h(PendingPurchaseView, { balance, purchaseResult }) : null,
        h(Box, { marginTop: 1 }),
        h(
            Text,
            { dimColor: true },
            busy ? "aplicando..." : balance.hasPendingPayment ? "c cancela a cobrança pendente · Esc volta" : "Enter compra tokens · Esc volta",
        ),
    );
}

function PendingPurchaseView(props: { balance: BillingBalance; purchaseResult: PurchaseResult | undefined }): React.ReactElement {
    const { balance, purchaseResult } = props;
    return h(
        Box,
        { flexDirection: "column", marginTop: 1, borderStyle: "round", borderColor: theme.warning, paddingX: 1 },
        h(Text, { bold: true, color: theme.warning }, `Cobrança pendente — ${balance.pendingPurchaseTokens ? `${balance.pendingPurchaseTokens.toLocaleString("pt-BR")} tokens` : "aguardando pagamento"}`),
        purchaseResult?.pixPayload
            ? h(Box, { flexDirection: "column", marginTop: 1 }, h(Text, { dimColor: true }, "PIX (escaneie ou copie o código abaixo):"), h(Text, null, renderQrAscii(purchaseResult.pixPayload)))
            : null,
        purchaseResult?.invoiceUrl
            ? h(Box, { flexDirection: "column", marginTop: 1 }, h(Text, { dimColor: true }, "Ou pague por este link (cartão/boleto/PIX):"), h(Text, null, purchaseResult.invoiceUrl))
            : h(Box, { marginTop: 1 }, h(Text, { dimColor: true }, "Gerada numa sessão anterior — sem QR/link aqui pra reexibir. Cancele e gere uma nova se precisar.")),
    );
}
