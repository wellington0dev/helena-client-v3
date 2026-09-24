import React from "react";
import { Box, Text, useInput } from "ink";
import { getLimits, getRateInfo, patchLimits, type Bounds, type LimitsPatch, type LimitsView, type RateInfo } from "../api/billing.ts";
import { UnauthorizedError } from "../backend.ts";
import { formatCost, formatMoney, parseBrlInput } from "./format-money.ts";
import { Form } from "./form.ts";
import { Loader } from "./loader.ts";
import { panel, SPACE, theme } from "./theme.ts";

const h = React.createElement;

function minutesAgo(iso: string, now: Date): string {
    const min = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
    if (min < 1) return "agora há pouco";
    if (min < 60) return `há ${min} min`;
    return `há ${Math.floor(min / 60)} h ${min % 60} min`;
}

/**
 * "Como a cotação funciona" (pedido do dono, 2026-09-24) — pura, testada em limits-screen.test.ts. Explica de onde vem
 * o preço de cada mensagem: custo do Google em US$ × cotação × margem.
 */
export function rateExplanation(rate: RateInfo, now: Date = new Date()): string[] {
    const cotacao = rate.usdBrlRate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    const fonte =
        rate.updatedAt === null
            ? `valor fixo (${rate.source}) — nenhuma API respondeu ainda`
            : `${rate.source === "awesomeapi" ? "AwesomeAPI" : rate.source}, atualizada ${minutesAgo(rate.updatedAt, now)}`;
    const margem = Math.round((rate.markup - 1) * 100);
    const exemplo =
        rate.example.source === "history"
            ? `Uma mensagem tua custa em média ${formatCost(rate.example.costBrl)} (últimos 30 dias, ${rate.example.messages} mensagens).`
            : `Uma mensagem típica custa por volta de ${formatCost(rate.example.costBrl)} (estimativa — ainda sem histórico teu).`;
    return [
        `Dólar hoje: R$ ${cotacao} (${fonte}).`,
        `O Google cobra a IA em dólar. Cada mensagem custa: custo real em US$ × cotação × ${rate.markup.toLocaleString("pt-BR")} (margem de ${margem}%).`,
        `A cotação se atualiza sozinha a cada ${rate.refreshIntervalMinutes} min; se a API falhar, vale a última cotação boa.`,
        exemplo,
    ];
}

/** Inteiro dentro da faixa — `undefined` = inválido. */
export function parseIntInRange(raw: string | undefined, b: Bounds): number | undefined {
    const text = (raw ?? "").trim();
    if (!/^\d+$/.test(text)) return undefined;
    const n = Number(text);
    return n >= b.min && n <= b.max ? n : undefined;
}

const brl = (v: number) => v.toFixed(2).replace(".", ",");

type Section = "view" | "owner" | "contacts" | "tasks";

/** `/limites` — limites de custo e de passos que o próprio dono configura, com a explicação da cotação. */
export function LimitsScreen(props: { backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized } = props;
    const [limits, setLimits] = React.useState<LimitsView | undefined>(undefined);
    const [rate, setRate] = React.useState<RateInfo | undefined>(undefined);
    const [section, setSection] = React.useState<Section>("view");
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) return onUnauthorized();
        setError(err instanceof Error ? err.message : String(err));
    }

    React.useEffect(() => {
        Promise.all([getLimits(backendUrl, token), getRateInfo(backendUrl, token)])
            .then(([l, r]) => {
                setLimits(l);
                setRate(r);
            })
            .catch(handleAsyncError);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    useInput((input, key) => {
        if (section !== "view" || busy) return;
        if (key.escape) return onExit();
        if (input === "m") setSection("owner");
        if (input === "c") setSection("contacts");
        if (input === "t") setSection("tasks");
    });

    async function save(patch: LimitsPatch): Promise<void> {
        setBusy(true);
        setError(undefined);
        try {
            setLimits(await patchLimits(backendUrl, token, patch));
            setSection("view");
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (!limits || !rate) return error ? h(Text, { color: theme.danger }, `Erro: ${error} — Esc volta`) : h(Loader, { text: "Carregando limites..." });
    const B = limits.bounds;
    const back = () => {
        setError(undefined);
        setSection("view");
    };

    if (section === "owner") {
        return h(Form, {
            title: "Minhas mensagens",
            description: ["Passos = chamadas à IA numa mesma mensagem (cada ferramenta usada é mais um passo).", "Ao bater um limite a Helena para e avisa; diga \"continue\" pra seguir."],
            fields: [
                { key: "turns", label: `Máximo de passos por mensagem (${B.ownerMaxTurns.min}–${B.ownerMaxTurns.max})`, initialValue: String(limits.owner.maxTurns) },
                { key: "cost", label: "Máximo de R$ por mensagem (vazio = sem limite)", initialValue: limits.owner.maxCostBrl === null ? "" : brl(limits.owner.maxCostBrl), optional: true },
            ],
            onSubmit: (v) => {
                const turns = parseIntInRange(v.turns, B.ownerMaxTurns);
                const cost = parseBrlInput(v.cost);
                if (turns === undefined) return setError(`Passos: número de ${B.ownerMaxTurns.min} a ${B.ownerMaxTurns.max}.`);
                if (cost === undefined || (cost !== null && (cost < B.ownerMaxCostBrl.min || cost > B.ownerMaxCostBrl.max))) return setError(`R$ por mensagem: de ${formatMoney(B.ownerMaxCostBrl.min)} a ${formatMoney(B.ownerMaxCostBrl.max)}, ou vazio.`);
                void save({ ownerMaxTurns: turns, ownerMaxCostBrl: cost });
            },
            onCancel: back,
            busy,
            error,
        });
    }

    if (section === "contacts") {
        return h(Form, {
            title: "Contatos e grupos (WhatsApp/Telegram)",
            description: ["Protege teus créditos: o que passar do limite fica sem resposta (texto fixo, sem gastar IA).", "Contato sem ferramentas usa sempre 1 passo por mensagem."],
            fields: [
                { key: "rate", label: `Mensagens por hora de cada contato (${B.contactRatePerHour.min}–${B.contactRatePerHour.max})`, initialValue: String(limits.contacts.ratePerHour) },
                { key: "groupRate", label: `Mensagens por hora de cada grupo (${B.groupRatePerHour.min}–${B.groupRatePerHour.max})`, initialValue: String(limits.contacts.groupRatePerHour) },
                { key: "turns", label: `Passos por mensagem de contato com ferramentas (${B.contactMaxTurnsWithRules.min}–${B.contactMaxTurnsWithRules.max})`, initialValue: String(limits.contacts.maxTurnsWithRules) },
                { key: "monthly", label: "Gasto máximo por mês de cada contato/grupo, em R$ (padrão)", initialValue: brl(limits.contacts.defaultMonthlyLimitBrl) },
            ],
            onSubmit: (v) => {
                const rate = parseIntInRange(v.rate, B.contactRatePerHour);
                const groupRate = parseIntInRange(v.groupRate, B.groupRatePerHour);
                const turns = parseIntInRange(v.turns, B.contactMaxTurnsWithRules);
                const monthly = parseBrlInput(v.monthly);
                if (rate === undefined || groupRate === undefined || turns === undefined) return setError("Confira os números: cada um tem a faixa indicada no rótulo.");
                if (monthly === undefined || monthly === null) return setError("Gasto por mês: valor em R$ (ex: 1 ou 2,50).");
                void save({ contactRatePerHour: rate, groupRatePerHour: groupRate, contactMaxTurnsWithRules: turns, defaultContactMonthlyLimitBrl: monthly });
            },
            onCancel: back,
            busy,
            error,
        });
    }

    if (section === "tasks") {
        return h(Form, {
            title: "Tarefas em segundo plano",
            description: ["Vale quando o executor de tarefas longas for ativado (tarefas divididas em passos, rodando sozinhas)."],
            fields: [
                { key: "budget", label: `Orçamento padrão por tarefa em R$ (${formatMoney(B.taskDefaultBudgetBrl.min)}–${formatMoney(B.taskDefaultBudgetBrl.max)})`, initialValue: brl(limits.tasks.defaultBudgetBrl) },
                { key: "steps", label: `Máximo de passos por tarefa (${B.taskMaxSteps.min}–${B.taskMaxSteps.max})`, initialValue: String(limits.tasks.maxSteps) },
                { key: "concurrent", label: `Tarefas ao mesmo tempo (${B.taskMaxConcurrent.min}–${B.taskMaxConcurrent.max})`, initialValue: String(limits.tasks.maxConcurrent) },
            ],
            onSubmit: (v) => {
                const budget = parseBrlInput(v.budget);
                const steps = parseIntInRange(v.steps, B.taskMaxSteps);
                const concurrent = parseIntInRange(v.concurrent, B.taskMaxConcurrent);
                if (budget == null || budget < B.taskDefaultBudgetBrl.min || budget > B.taskDefaultBudgetBrl.max) return setError("Orçamento: valor em R$ dentro da faixa.");
                if (steps === undefined || concurrent === undefined) return setError("Confira os números: cada um tem a faixa indicada no rótulo.");
                void save({ taskDefaultBudgetBrl: budget, taskMaxSteps: steps, taskMaxConcurrent: concurrent });
            },
            onCancel: back,
            busy,
            error,
        });
    }

    const line = (label: string, value: string) => h(Text, null, `  ${label}: `, h(Text, { bold: true }, value));
    return h(
        Box,
        { flexDirection: "column", ...panel("border") },
        h(Text, { bold: true, color: theme.primary }, "Limites e custos"),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, { bold: true }, "Como a cotação funciona"),
        ...rateExplanation(rate).map((text, i) => h(Text, { key: `r${i}`, color: theme.textMuted }, `  ${text}`)),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, { bold: true }, "Minhas mensagens (m)"),
        line("Passos por mensagem", String(limits.owner.maxTurns)),
        line("Custo máximo por mensagem", limits.owner.maxCostBrl === null ? "sem limite" : formatMoney(limits.owner.maxCostBrl)),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, { bold: true }, "Contatos e grupos (c)"),
        line("Mensagens por hora (contato / grupo)", `${limits.contacts.ratePerHour} / ${limits.contacts.groupRatePerHour}`),
        line("Passos por mensagem com ferramentas", String(limits.contacts.maxTurnsWithRules)),
        line("Gasto máximo por mês (padrão)", formatMoney(limits.contacts.defaultMonthlyLimitBrl)),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, { bold: true }, "Tarefas em segundo plano (t)"),
        line("Orçamento por tarefa", formatMoney(limits.tasks.defaultBudgetBrl)),
        line("Passos por tarefa / ao mesmo tempo", `${limits.tasks.maxSteps} / ${limits.tasks.maxConcurrent}`),
        h(Box, { marginTop: SPACE.tight }),
        error ? h(Text, { color: theme.danger }, `Erro: ${error}`) : null,
        h(Text, { color: theme.textMuted }, busy ? "salvando..." : "m minhas mensagens · c contatos e grupos · t tarefas · Esc volta"),
    );
}
