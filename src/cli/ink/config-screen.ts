import React from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import chalk from "chalk";
import {
    createApiToken,
    getMe,
    listApiTokens,
    revokeApiToken,
    setAutoApproveShell,
    setProactiveMessages,
    setTelemetryConsent,
    type ApiTokenSummary,
    type CreatedApiToken,
    type CurrentUser,
} from "../backend.ts";
import { SelectMenu, type SelectMenuItem } from "./select-menu.ts";

const h = React.createElement;

/** `SelectMenu` é genérico (`SelectMenu<T>`), mas `createElement` não tem como instanciar esse genérico sem JSX — mesmo problema/solução de `HistoryStatic` em app.ts. Toda seleção nesta tela é por string (role/id), então um alias só resolve todos os usos. */
const StringSelectMenu = SelectMenu as unknown as (props: { items: SelectMenuItem<string>[]; onSelect: (value: string) => void; onCancel?: () => void }) => React.ReactElement;

/** `/config` — primeira tela do CLI equivalente ao painel (perfil/preferências, ver docs de arquitetura do client), padrão opencode/Hermes Agent CLI: tudo dentro do mesmo TUI, Esc sempre volta um nível, nunca abre processo/tela nova. */
type Screen = { kind: "menu" } | { kind: "tokens" } | { kind: "create-token" } | { kind: "token-created"; created: CreatedApiToken };

function toggleLabel(enabled: boolean): string {
    return enabled ? chalk.green("ligado") : chalk.dim("desligado");
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return "nunca";
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ConfigScreen(props: { backendUrl: string; token: string; onExit: () => void }): React.ReactElement {
    const { backendUrl, token, onExit } = props;
    const [me, setMe] = React.useState<CurrentUser | undefined>(undefined);
    const [tokens, setTokens] = React.useState<ApiTokenSummary[] | undefined>(undefined);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [screen, setScreen] = React.useState<Screen>({ kind: "menu" });
    const [tokenLabelDraft, setTokenLabelDraft] = React.useState("");

    const reloadMe = React.useCallback(async () => {
        try {
            setMe(await getMe(backendUrl, token));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [backendUrl, token]);

    const reloadTokens = React.useCallback(async () => {
        try {
            setTokens(await listApiTokens(backendUrl, token));
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reloadMe();
    }, [reloadMe]);

    // Esc sempre sobe UM nível na hierarquia menu → tokens → create-token/token-created — nunca pula direto pro chat de um nível mais fundo. `useInput` roda independente de qual componente tem `focus` (isso só afeta o TextInput capturar a DIGITAÇÃO, não os hooks de tecla), então funciona igual em toda tela, inclusive create-token.
    useInput((_input, key) => {
        if (!key.escape) return;
        if (screen.kind === "menu") onExit();
        else if (screen.kind === "tokens") setScreen({ kind: "menu" });
        else setScreen({ kind: "tokens" }); // create-token ou token-created
    });

    if (error) {
        return h(Box, { flexDirection: "column", borderStyle: "round", borderColor: "red", paddingX: 1 }, h(Text, { color: "red" }, `Erro: ${error}`), h(Text, { dimColor: true }, "Esc pra voltar ao chat"));
    }
    if (!me) return h(Text, { dimColor: true }, "Carregando configurações...");

    async function toggle(action: () => Promise<unknown>): Promise<void> {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            await reloadMe();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }

    if (screen.kind === "menu") {
        const items: SelectMenuItem<string>[] = [
            { label: "Telemetria (erros/desempenho)", hint: toggleLabel(me.telemetryConsent), value: "telemetry" },
            { label: "Sempre permitir comandos shell", hint: toggleLabel(me.autoApproveShell), value: "auto-shell" },
            { label: "Mensagens por iniciativa própria", hint: toggleLabel(me.allowProactiveMessages), value: "proactive" },
            { label: "Tokens de API", hint: "gerenciar →", value: "tokens" },
        ];
        return h(
            Box,
            { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
            h(Text, { bold: true, color: "cyan" }, `Configurações — ${me.email}`),
            h(Box, { marginTop: 1 }),
            h(StringSelectMenu, {
                items,
                onSelect: (value: string) => {
                    if (value === "tokens") {
                        setScreen({ kind: "tokens" });
                        void reloadTokens();
                    } else if (value === "telemetry") void toggle(() => setTelemetryConsent(backendUrl, token, !me.telemetryConsent));
                    else if (value === "auto-shell") void toggle(() => setAutoApproveShell(backendUrl, token, !me.autoApproveShell));
                    else if (value === "proactive") void toggle(() => setProactiveMessages(backendUrl, token, !me.allowProactiveMessages));
                },
            }),
            h(Box, { marginTop: 1 }),
            h(Text, { dimColor: true }, busy ? "salvando..." : "1-4 ou ↑↓+Enter · Esc volta pro chat"),
        );
    }

    if (screen.kind === "tokens") {
        if (!tokens) return h(Text, { dimColor: true }, "Carregando tokens...");

        const items: SelectMenuItem<string>[] = [
            { label: "+ Criar novo token", value: "__create__" },
            ...tokens.map((t) => ({ label: t.label ?? "(sem nome)", hint: `usado ${formatDate(t.lastUsedAt)} · criado ${formatDate(t.createdAt)} · Enter pra revogar`, value: t.id })),
        ];

        async function handleRevoke(id: string): Promise<void> {
            setBusy(true);
            try {
                await revokeApiToken(backendUrl, token, id);
                await reloadTokens();
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy(false);
            }
        }

        return h(
            Box,
            { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
            h(Text, { bold: true, color: "cyan" }, "Tokens de API"),
            h(Text, { dimColor: true }, "Usados pelo helena agent (execução remota) — o valor só aparece uma vez, na criação."),
            h(Box, { marginTop: 1 }),
            tokens.length === 0 ? h(Text, { dimColor: true }, "Nenhum token ainda — comece por aqui:") : null,
            h(StringSelectMenu, {
                items,
                onSelect: (value: string) => {
                    if (value === "__create__") setScreen({ kind: "create-token" });
                    else void handleRevoke(value);
                },
            }),
            h(Box, { marginTop: 1 }),
            h(Text, { dimColor: true }, busy ? "aplicando..." : "1-9, ↑↓+Enter cria/revoga · Esc volta"),
        );
    }

    if (screen.kind === "create-token") {
        async function handleSubmit(label: string): Promise<void> {
            setBusy(true);
            try {
                const created = await createApiToken(backendUrl, token, label.trim() || undefined);
                setTokenLabelDraft("");
                setScreen({ kind: "token-created", created });
                await reloadTokens();
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                setBusy(false);
            }
        }

        return h(
            Box,
            { flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
            h(Text, { bold: true, color: "cyan" }, "Novo token de API"),
            h(Box, { marginTop: 1, gap: 1 }, h(Text, null, "Nome (opcional):"), h(TextInput, { value: tokenLabelDraft, onChange: setTokenLabelDraft, onSubmit: (v: string) => void handleSubmit(v), focus: !busy })),
            h(Box, { marginTop: 1 }),
            h(Text, { dimColor: true }, busy ? "criando..." : "Enter confirma · Esc cancela (volta pra lista)"),
        );
    }

    // screen.kind === "token-created"
    const created = screen.created;
    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: "green", paddingX: 1 },
        h(Text, { bold: true, color: "green" }, "Token criado"),
        h(Text, { dimColor: true }, "Copie agora — não vai aparecer de novo:"),
        h(Box, { marginTop: 1 }),
        h(Text, { color: "yellow" }, created.token),
        h(Box, { marginTop: 1 }),
        h(Text, { dimColor: true }, "Esc volta pra lista de tokens"),
    );
}
