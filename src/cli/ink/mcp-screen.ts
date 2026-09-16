import React from "react";
import { Text, useInput } from "ink";
import { createMcpConnection, deleteMcpConnection, listMcpConnections, updateMcpConnection, type McpConnectionSummary } from "../api/mcp.ts";
import { UnauthorizedError } from "../backend.ts";
import { CrudScreen } from "./crud-screen.ts";
import { Form } from "./form.ts";
import { McpGuideScreen } from "./mcp-guide-screen.ts";

const h = React.createElement;

const McpCrudScreen = CrudScreen as unknown as (props: {
    title: string;
    items: McpConnectionSummary[] | undefined;
    itemLabel: (item: McpConnectionSummary) => { label: string; hint?: string };
    onSelect: (item: McpConnectionSummary) => void;
    onCreate: () => void;
    onDelete: (item: McpConnectionSummary) => Promise<void>;
    busy: boolean;
    error?: string;
    onExit: () => void;
}) => React.ReactElement;

function connectionLabel(conn: McpConnectionSummary): { label: string; hint: string } {
    const status = conn.enabled ? "ligado" : "desligado";
    return { label: conn.name, hint: `${conn.serverUrl} · ${status}${conn.hasAuthToken ? " · com token" : ""}` };
}

/**
 * Resolve o campo texto livre "s/n" do form pro booleano `enabled` —
 * exportada como função pura (testável sem renderizar nada) porque um
 * bug real aqui já aconteceu uma vez: a versão anterior era `!== "n"`,
 * que silenciosamente vira "ligado" pra QUALQUER valor que não seja
 * exatamente "n" (typo, "não", campo em branco por edição incompleta).
 * Só "s"/"n" (case-insensitive) contam como resposta explícita — texto
 * livre inesperado cai no valor JÁ SALVO (edição) ou `true` (criação),
 * nunca é interpretado como "ligado" por omissão.
 */
export function resolveEnabledField(raw: string | undefined, currentValue: boolean | undefined): boolean {
    const normalized = raw?.trim().toLowerCase() ?? "";
    if (normalized === "s") return true;
    if (normalized === "n") return false;
    return currentValue ?? true;
}

/** Sub-estado plano owned pelo componente de topo, mesmo padrão de `contacts-screen.ts`/`config-screen.ts` — nunca dentro de um componente filho (ver comentário em `contacts-screen.ts#ScreenState`). */
type ScreenState = { kind: "list" } | { kind: "form"; editing?: McpConnectionSummary } | { kind: "guide" };

/** `/integracoes` — CRUD completo de conexões MCP + guia estático de como montar um servidor compatível (tecla `g` na lista). */
export function McpScreen(props: { backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized } = props;
    const [connections, setConnections] = React.useState<McpConnectionSummary[] | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [screen, setScreen] = React.useState<ScreenState>({ kind: "list" });

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) {
            onUnauthorized();
            return;
        }
        setError(err instanceof Error ? err.message : String(err));
    }

    const reload = React.useCallback(async () => {
        try {
            setConnections(await listMcpConnections(backendUrl, token));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    useInput((input, key) => {
        if (screen.kind !== "list") return;
        if (key.escape) {
            onExit();
            return;
        }
        if (input === "g") setScreen({ kind: "guide" });
    });

    if (error) {
        return h(Text, { color: "red" }, `Erro: ${error} — Esc pra voltar ao chat`);
    }

    async function handleDelete(conn: McpConnectionSummary): Promise<void> {
        setBusy(true);
        try {
            await deleteMcpConnection(backendUrl, token, conn.id);
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleFormSubmit(editing: McpConnectionSummary | undefined, values: Record<string, string>): Promise<void> {
        setBusy(true);
        try {
            const enabled = resolveEnabledField(values.enabled, editing?.enabled);
            if (editing) {
                await updateMcpConnection(backendUrl, token, editing.id, {
                    name: values.name?.trim() || editing.name,
                    serverUrl: values.serverUrl?.trim() || editing.serverUrl,
                    authToken: values.authToken?.trim() || undefined,
                    enabled,
                });
            } else {
                await createMcpConnection(backendUrl, token, {
                    name: values.name?.trim() ?? "",
                    serverUrl: values.serverUrl?.trim() ?? "",
                    authToken: values.authToken?.trim() || undefined,
                    enabled,
                });
            }
            await reload();
            setScreen({ kind: "list" });
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (screen.kind === "guide") {
        return h(McpGuideScreen, { backendUrl, token, onExit: () => setScreen({ kind: "list" }) });
    }

    if (screen.kind === "list") {
        return h(McpCrudScreen, {
            title: "Integrações (MCP) — g abre o guia de como montar um servidor",
            items: connections,
            itemLabel: connectionLabel,
            onSelect: (conn) => setScreen({ kind: "form", editing: conn }),
            onCreate: () => setScreen({ kind: "form" }),
            onDelete: handleDelete,
            busy,
            onExit,
        });
    }

    // screen.kind === "form"
    const editing = screen.editing;
    return h(Form, {
        title: editing ? `Editar integração — ${editing.name}` : "Nova integração MCP",
        fields: [
            { key: "name", label: "Nome", initialValue: editing?.name ?? "" },
            { key: "serverUrl", label: "URL do servidor", initialValue: editing?.serverUrl ?? "" },
            { key: "authToken", label: editing ? "Token (deixe em branco pra manter o já salvo)" : "Token", optional: true },
            { key: "enabled", label: "Ligado? (s/n)", initialValue: editing ? (editing.enabled ? "s" : "n") : "s" },
        ],
        onSubmit: (values) => void handleFormSubmit(editing, values),
        onCancel: () => setScreen({ kind: "list" }),
        busy,
    });
}
