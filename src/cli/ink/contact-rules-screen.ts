import React from "react";
import { Box, Text, useInput } from "ink";
import { createContactRule, deleteContactRule, listContactRules, listRuleAudit, testDisclosureFilter, updateContactRule, type AuditEntry, type ContactRule } from "../api/contact-rules.ts";
import { listContacts, type Contact } from "../api/contacts.ts";
import { listMcpConnections, type McpConnectionSummary } from "../api/mcp.ts";
import { UnauthorizedError } from "../backend.ts";
import { CrudScreen } from "./crud-screen.ts";
import { ErrorPanel } from "./error-panel.ts";
import { Form } from "./form.ts";
import { formValuesToRule, PRESET_NAMES, ruleSummary, ruleToFormValues, type RuleScope } from "./rule-form.ts";
import { SelectMenu } from "./select-menu.ts";
import { panel, SPACE, theme } from "./theme.ts";

const h = React.createElement;

/** Legenda fixa — o dono precisa saber o que o SISTEMA garante e o que depende da IA obedecer. */
export const GUARANTEE_LEGEND = [
    "Garantido pelo sistema: quais ferramentas existem, pastas e tipos de arquivo (pasta proibida sempre vence), agenda/recado só criar, nunca shell nem apagar, integrações só as liberadas, dados proibidos (CPF, termos, modelos) bloqueados na resposta, limites de gasto.",
    "Orientação pra IA (interpretada, sem garantia): \"pra quê\", \"quando o cliente pedir\" e o texto livre de \"nunca\". O contato pode usar o que foi liberado a qualquer momento.",
];

const RuleCrud = CrudScreen as unknown as (props: {
    title: string;
    items: ContactRule[] | undefined;
    itemLabel: (item: ContactRule) => { label: string; hint?: string };
    onSelect: (item: ContactRule) => void;
    onCreate: () => void;
    createLabel?: string;
    onDelete: (item: ContactRule) => Promise<void>;
    busy: boolean;
    onExit: () => void;
}) => React.ReactElement;

type Screen = { kind: "list" } | { kind: "scope" } | { kind: "step"; step: 1 | 2 | 3; scope: RuleScope; editing?: ContactRule } | { kind: "audit" };

const channelName = (c?: string | null) => (c === "telegram" ? "Telegram" : "WhatsApp");

/** `/regras` — regras de atendimento nos canais (2026-09-24): o que contatos/grupos podem fazer através da Helena. */
export function ContactRulesScreen(props: { backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized } = props;
    const [rules, setRules] = React.useState<ContactRule[] | undefined>(undefined);
    const [contacts, setContacts] = React.useState<Contact[]>([]);
    const [mcp, setMcp] = React.useState<McpConnectionSummary[]>([]);
    const [audit, setAudit] = React.useState<AuditEntry[] | undefined>(undefined);
    const [screen, setScreen] = React.useState<Screen>({ kind: "list" });
    const [draft, setDraft] = React.useState<Record<string, string>>({});
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [formError, setFormError] = React.useState<string | undefined>(undefined);
    const [testResult, setTestResult] = React.useState<string[] | undefined>(undefined);

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) return onUnauthorized();
        setError(err instanceof Error ? err.message : String(err));
    }

    const reload = React.useCallback(async () => {
        try {
            const [r, c, m] = await Promise.all([listContactRules(backendUrl, token), listContacts(backendUrl, token), listMcpConnections(backendUrl, token)]);
            setRules(r);
            setContacts(c);
            setMcp(m);
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    function scopeOf(rule: ContactRule): RuleScope {
        if (rule.scopeType === "contact") {
            const c = contacts.find((x) => x.id === rule.scopeContactId);
            return { type: "contact", contactId: rule.scopeContactId ?? undefined, channel: rule.scopeChannel ?? undefined, label: `${c?.name ?? "contato"} (${channelName(rule.scopeChannel)})` };
        }
        if (rule.scopeType === "group") return { type: "group", groupId: rule.scopeGroupId ?? undefined, channel: rule.scopeChannel ?? undefined, label: `grupo (${channelName(rule.scopeChannel)})` };
        return { type: "channel", channel: rule.scopeChannel ?? "whatsapp", label: `todos do ${channelName(rule.scopeChannel)}` };
    }

    useInput((input, key) => {
        if (error) {
            if (key.escape) onExit();
            return;
        }
        if (screen.kind === "list" && input === "a" && !busy) {
            setAudit(undefined);
            setScreen({ kind: "audit" });
            listRuleAudit(backendUrl, token).then(setAudit).catch(handleAsyncError);
        }
        if (screen.kind === "audit" && key.escape) setScreen({ kind: "list" });
    });

    if (error) return h(ErrorPanel, { error });

    function startEdit(rule: ContactRule): void {
        const values = ruleToFormValues(rule);
        // Mostra o NOME da integração no campo, não o id.
        const conn = mcp.find((m) => m.id === values.mcpConnection);
        setDraft({ ...values, mcpConnection: conn?.name ?? values.mcpConnection, enabled: rule.enabled ? "s" : "n" });
        setTestResult(undefined);
        setFormError(undefined);
        setScreen({ kind: "step", step: 1, scope: scopeOf(rule), editing: rule });
    }

    async function save(values: Record<string, string>, scope: RuleScope, editing?: ContactRule): Promise<void> {
        const { input, errors } = formValuesToRule(values, scope, mcp, !/^\s*n/i.test(values.enabled ?? "s"));
        if (!input) return setFormError(errors.join(" "));
        setBusy(true);
        setFormError(undefined);
        try {
            if (editing) await updateContactRule(backendUrl, token, editing.id, input);
            else await createContactRule(backendUrl, token, input);
            await reload();
            setScreen({ kind: "list" });
        } catch (err) {
            // Erro de validação do backend volta pro formulário (não descarta o que foi digitado).
            if (err instanceof UnauthorizedError) return onUnauthorized();
            setFormError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }

    if (screen.kind === "audit") {
        return h(
            Box,
            { flexDirection: "column", ...panel("border") },
            h(Text, { bold: true, color: theme.primary }, "Regras de atendimento — auditoria"),
            h(Box, { marginTop: SPACE.tight }),
            !audit
                ? h(Text, { color: theme.textMuted }, "Carregando...")
                : audit.length === 0
                  ? h(Text, { color: theme.textMuted }, "Nada registrado ainda.")
                  : audit.slice(0, 30).map((a) =>
                        h(
                            Text,
                            { key: a.id, color: a.outcome === "ok" ? undefined : theme.warning, wrap: "truncate" },
                            `${new Date(a.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · ${a.senderName ?? "?"} (${a.channel}) · ${a.kind === "output_blocked" ? "resposta bloqueada" : a.toolName ?? a.kind} · ${a.outcome}${a.reason ? ` — ${a.reason}` : ""}`,
                        ),
                    ),
            h(Box, { marginTop: SPACE.tight }),
            h(Text, { color: theme.textMuted }, "Esc volta"),
        );
    }

    if (screen.kind === "scope") {
        const items = [
            { label: "Todos os contatos do WhatsApp", value: { type: "channel", channel: "whatsapp", label: "todos do WhatsApp" } as RuleScope },
            { label: "Todos os contatos do Telegram", value: { type: "channel", channel: "telegram", label: "todos do Telegram" } as RuleScope },
            ...contacts.map((c) => ({ label: `${c.name ?? c.contactId} (${channelName(c.channel)})`, value: { type: "contact", contactId: c.id, channel: c.channel, label: `${c.name ?? c.contactId} (${channelName(c.channel)})` } as RuleScope })),
        ];
        return h(
            Box,
            { flexDirection: "column", ...panel("border") },
            h(Text, { bold: true, color: theme.primary }, "Nova regra — pra quem vale?"),
            h(Box, { marginTop: SPACE.tight }),
            h(SelectMenu<RuleScope>, {
                items,
                onSelect: (scope) => {
                    setDraft(ruleToFormValues());
                    setTestResult(undefined);
                    setFormError(undefined);
                    setScreen({ kind: "step", step: 1, scope });
                },
                onCancel: () => setScreen({ kind: "list" }),
            }),
        );
    }

    if (screen.kind === "step") {
        const { scope, editing } = screen;
        const next = (values: Record<string, string>, step: 1 | 2 | 3) => {
            setDraft((d) => ({ ...d, ...values }));
            setFormError(undefined);
            setScreen({ kind: "step", step, scope, editing });
        };
        const back = () => (screen.step === 1 ? setScreen({ kind: "list" }) : setScreen({ kind: "step", step: (screen.step - 1) as 1 | 2, scope, editing }));

        if (screen.step === 1) {
            return h(Form, {
                key: "s1",
                title: `${editing ? "Editar" : "Nova"} regra (1/3) — ${scope.label}`,
                description: GUARANTEE_LEGEND,
                fields: [
                    { key: "name", label: "Nome da regra", initialValue: draft.name },
                    { key: "task", label: "Pra quê (orientação): ex. \"consultar status de pedido\"", initialValue: draft.task, optional: true },
                    { key: "condition", label: "Quando o cliente pedir (orientação)", initialValue: draft.condition, optional: true },
                    { key: "forbidden", label: "Nunca (orientação, texto livre)", initialValue: draft.forbidden, optional: true },
                    { key: "calCreate", label: "Pode CRIAR compromisso na tua agenda? (s/n)", initialValue: draft.calCreate },
                    { key: "calAvail", label: "Pode ver se um horário está livre? (s/n)", initialValue: draft.calAvail },
                    { key: "calOnlyFree", label: "Só marcar em horário livre? (s/n)", initialValue: draft.calOnlyFree },
                    { key: "calPerDay", label: "Compromissos por dia (1–20)", initialValue: draft.calPerDay },
                    { key: "notes", label: "Pode deixar recado nas tuas notas? (s/n)", initialValue: draft.notes },
                    { key: "notify", label: "Me avisar quando criar/gravar algo? (s/n)", initialValue: draft.notify },
                    { key: "enabled", label: "Regra ligada? (s/n)", initialValue: draft.enabled ?? "s" },
                ],
                onSubmit: (v) => next(v, 2),
                onCancel: back,
                submitLabel: "Enter avança",
                error: formError,
            });
        }
        if (screen.step === 2) {
            return h(Form, {
                key: "s2",
                title: `Arquivos e integrações (2/3) — ${scope.label}`,
                description: ["Deixe em branco o que não quiser liberar. Pastas: caminho completo, separadas por vírgula. Tipos: ex. pdf, xlsx.", "Pasta proibida sempre vence. Nunca há shell nem apagar arquivo."],
                fields: [
                    { key: "machine", label: "Máquina (nome do dispositivo)", initialValue: draft.machine, optional: true },
                    { key: "readDirs", label: "Pastas que pode LER", initialValue: draft.readDirs, optional: true },
                    { key: "readExts", label: "Tipos que pode ler", initialValue: draft.readExts, optional: true },
                    { key: "writeDirs", label: "Pastas onde pode GRAVAR", initialValue: draft.writeDirs, optional: true },
                    { key: "writeExts", label: "Tipos que pode gravar", initialValue: draft.writeExts, optional: true },
                    { key: "deniedDirs", label: "Pastas PROIBIDAS", initialValue: draft.deniedDirs, optional: true },
                    { key: "mcpConnection", label: `Integração MCP (${mcp.map((m) => m.name).join(", ") || "nenhuma cadastrada"})`, initialValue: draft.mcpConnection, optional: true },
                    { key: "mcpTools", label: "Ferramentas da integração liberadas (nomes, por vírgula)", initialValue: draft.mcpTools, optional: true },
                ],
                onSubmit: (v) => next(v, 3),
                onCancel: back,
                submitLabel: "Enter avança",
                error: formError,
            });
        }
        return h(Form, {
            key: "s3",
            title: `Nunca fornecer — garantido (3/3) — ${scope.label}`,
            description: [
                `Tipos prontos: ${Object.values(PRESET_NAMES).join(", ")}. Termos: palavras/valores exatos. Modelos: # dígito, @ letra, * trecho (ex: PED-####).`,
                "Resposta que contiver algum deles é bloqueada antes de chegar à pessoa, e você é avisado.",
                ...(testResult ? [testResult.length ? `Teste: bloquearia (${testResult.join(", ")}).` : "Teste: passaria (nada proibido encontrado)."] : []),
            ],
            fields: [
                { key: "presets", label: "Tipos prontos (por vírgula)", initialValue: draft.presets, optional: true },
                { key: "terms", label: "Termos proibidos (por vírgula)", initialValue: draft.terms, optional: true },
                { key: "templates", label: "Modelos (por vírgula)", initialValue: draft.templates, optional: true },
                { key: "test", label: "Testar com um texto (opcional — preenchido, Enter só testa)", optional: true },
            ],
            onSubmit: (v) => {
                const merged = { ...draft, ...v };
                if (v.test?.trim()) {
                    const { input, errors } = formValuesToRule({ ...merged, name: merged.name || "teste" }, scope, mcp);
                    if (!input) return setFormError(errors.join(" "));
                    testDisclosureFilter(backendUrl, token, input.disclosure ?? { presets: [], terms: [], templates: [] }, v.test)
                        .then((r) => setTestResult(r.matched))
                        .catch((err) => setFormError(err instanceof Error ? err.message : String(err)));
                    setDraft(merged);
                    return;
                }
                void save(merged, scope, editing);
            },
            onCancel: back,
            submitLabel: "Enter salva",
            busy,
            error: formError,
        });
    }

    return h(
        Box,
        { flexDirection: "column" },
        h(RuleCrud, {
            title: "Regras de atendimento (WhatsApp/Telegram)",
            items: rules,
            itemLabel: (r) => {
                const s = scopeOf(r);
                return { label: r.name, hint: `${s.label} · ${ruleSummary(r)}${r.enabled ? "" : " · desligada"}` };
            },
            onSelect: startEdit,
            onCreate: () => setScreen({ kind: "scope" }),
            createLabel: "+ Nova regra",
            onDelete: async (r) => {
                setBusy(true);
                try {
                    await deleteContactRule(backendUrl, token, r.id);
                    await reload();
                } catch (err) {
                    handleAsyncError(err);
                } finally {
                    setBusy(false);
                }
            },
            busy,
            onExit,
        }),
        h(Box, { flexDirection: "column", paddingX: SPACE.tight }, ...GUARANTEE_LEGEND.map((t, i) => h(Text, { key: i, color: theme.textMuted }, t)), h(Text, { color: theme.textMuted }, "a auditoria (o que os contatos fizeram)")),
    );
}
