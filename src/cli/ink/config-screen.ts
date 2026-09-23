import React from "react";
import { Box, Text, useInput } from "ink";
import {
    createApiToken,
    getMe,
    listApiTokens,
    revokeApiToken,
    setAutoApproveShell,
    setProactiveMessages,
    setTelemetryConsent,
    UnauthorizedError,
    type ApiTokenSummary,
    type CreatedApiToken,
    type CurrentUser,
} from "../backend.ts";
import { CrudScreen } from "./crud-screen.ts";
import { ErrorPanel } from "./error-panel.ts";
import { Form } from "./form.ts";
import { Loader } from "./loader.ts";
import { SelectMenu, type SelectMenuItem } from "./select-menu.ts";
import { c, theme, panel, SPACE } from "./theme.ts";

const h = React.createElement;

/** `SelectMenu`/`CrudScreen` são genéricos, mas `createElement` não tem como instanciar esse genérico sem JSX — mesmo problema/solução de `HistoryStatic` em app.ts. Toda seleção nesta tela é por string (role/id), então um alias só resolve todos os usos. */
const StringSelectMenu = SelectMenu as unknown as (props: { items: SelectMenuItem<string>[]; onSelect: (value: string) => void; onCancel?: () => void }) => React.ReactElement;
const TokenCrudScreen = CrudScreen as unknown as (props: {
    title: string;
    items: ApiTokenSummary[] | undefined;
    itemLabel: (item: ApiTokenSummary) => { label: string; hint?: string };
    onCreate: () => void;
    onDelete: (item: ApiTokenSummary) => Promise<void>;
    busy: boolean;
    onExit: () => void;
}) => React.ReactElement;

/** `/config` — primeira tela do CLI equivalente ao painel (perfil/preferências, ver docs de arquitetura do client), padrão opencode/Hermes Agent CLI: tudo dentro do mesmo TUI, Esc sempre volta um nível, nunca abre processo/tela nova. */
type Screen = { kind: "menu" } | { kind: "tokens" } | { kind: "create-token" } | { kind: "token-created"; created: CreatedApiToken };

function toggleLabel(enabled: boolean): string {
    return enabled ? c.success("ligado") : c.muted("desligado");
}

function formatDate(iso: string | null | undefined): string {
    if (!iso) return "nunca";
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ConfigScreen(props: { backendUrl: string; token: string; startAt?: "tokens"; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, startAt, onExit, onUnauthorized } = props;
    const [me, setMe] = React.useState<CurrentUser | undefined>(undefined);
    const [tokens, setTokens] = React.useState<ApiTokenSummary[] | undefined>(undefined);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [screen, setScreen] = React.useState<Screen>({ kind: startAt ?? "menu" });

    /** Toda chamada autenticada desta tela passa por aqui — trata sessão expirada (relogin) de um jeito uniforme em vez de só pintar erro vermelho e travar a tela até o dono reabrir o `helena` manualmente. */
    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) {
            onUnauthorized();
            return;
        }
        setError(err instanceof Error ? err.message : String(err));
    }

    const reloadMe = React.useCallback(async () => {
        try {
            setMe(await getMe(backendUrl, token));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    const reloadTokens = React.useCallback(async () => {
        try {
            setTokens(await listApiTokens(backendUrl, token));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reloadMe();
        if (startAt === "tokens") void reloadTokens(); // veio do menu de configurações direto pra lista de tokens
    }, [reloadMe, reloadTokens, startAt]);

    // Esc sempre sobe UM nível na hierarquia menu → tokens → create-token/token-created — nunca pula direto pro chat de um nível mais fundo. `useInput` roda independente de qual componente tem `focus` (isso só afeta o TextInput capturar a DIGITAÇÃO, não os hooks de tecla), então funciona igual em toda tela, inclusive create-token. Não se aplica à tela "tokens" — o próprio `CrudScreen` já trata Esc (chamando `onExit` que passamos abaixo).
    useInput((_input, key) => {
        if (!key.escape) return;
        // Erro visível (tela abaixo renderiza só "Erro: ... — Esc pra voltar ao chat") sai direto pro chat, não
        // importa o `screen.kind` — bug real encontrado em revisão (2026-09-22): sem isso, um erro em "tokens" (sem
        // `startAt === "tokens"`) travava a TUI (nem este handler nem o Esc do próprio CrudScreen, desmontado,
        // reagiam), e um erro em "create-token"/"token-created" exigia DOIS Esc (o erro nunca era limpo).
        if (error) {
            onExit();
            return;
        }
        if (screen.kind === "menu" || (screen.kind === "tokens" && startAt === "tokens")) onExit();
        else if (screen.kind === "create-token" || screen.kind === "token-created") setScreen({ kind: "tokens" });
    });

    if (error) return h(ErrorPanel, { error });
    if (!me) return h(Loader, { text: "Carregando configurações..." });

    async function toggle(action: () => Promise<unknown>): Promise<void> {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            await reloadMe();
        } catch (err) {
            handleAsyncError(err);
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
            { flexDirection: "column", ...panel("border") },
            h(Text, { bold: true, color: theme.primary }, `Configurações — ${me.email}`),
            h(Box, { marginTop: SPACE.tight }),
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
            h(Box, { marginTop: SPACE.tight }),
            h(Text, { color: theme.textMuted }, busy ? "salvando..." : "1-4 ou ↑↓+Enter · Esc volta pro chat"),
        );
    }

    if (screen.kind === "tokens") {
        async function handleDelete(t: ApiTokenSummary): Promise<void> {
            setBusy(true);
            try {
                await revokeApiToken(backendUrl, token, t.id);
                await reloadTokens();
            } catch (err) {
                handleAsyncError(err);
            } finally {
                setBusy(false);
            }
        }

        return h(TokenCrudScreen, {
            title: "Tokens de API — usados pelo helena agent (execução remota)",
            items: tokens,
            itemLabel: (t) => ({ label: t.label ?? "(sem nome)", hint: `usado ${formatDate(t.lastUsedAt)} · criado ${formatDate(t.createdAt)}` }),
            onCreate: () => setScreen({ kind: "create-token" }),
            onDelete: handleDelete,
            busy,
            onExit: () => (startAt === "tokens" ? onExit() : setScreen({ kind: "menu" })),
        });
    }

    if (screen.kind === "create-token") {
        async function handleFormSubmit(values: Record<string, string>): Promise<void> {
            setBusy(true);
            try {
                const created = await createApiToken(backendUrl, token, values.label?.trim() || undefined);
                setScreen({ kind: "token-created", created });
                await reloadTokens();
            } catch (err) {
                handleAsyncError(err);
            } finally {
                setBusy(false);
            }
        }

        return h(Form, {
            title: "Novo token de API",
            fields: [{ key: "label", label: "Nome", optional: true }],
            onSubmit: (values) => void handleFormSubmit(values),
            onCancel: () => setScreen({ kind: "tokens" }),
            submitLabel: "Enter confirma",
            busy,
        });
    }

    // screen.kind === "token-created"
    const created = screen.created;
    return h(
        Box,
        { flexDirection: "column", ...panel("success") },
        h(Text, { bold: true, color: theme.success }, "Token criado"),
        h(Text, { color: theme.textMuted }, "Copie agora — não vai aparecer de novo:"),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, { color: theme.warning }, created.token),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, { color: theme.textMuted }, "Esc volta pra lista de tokens"),
    );
}
