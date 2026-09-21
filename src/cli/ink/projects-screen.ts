import React from "react";
import { Box, Text, useInput } from "ink";
import { AGENT_ROLES, DEFAULT_AGENT_NAMES, listAgentPersonas, resetAgentPersona, setAgentPersonaName } from "../api/agent-personas.ts";
import { createProject, listAutonomyPolicies, listProjects, setAutonomyPolicy, type AutonomyDecision, type AutonomyMode, type ProjectSummary } from "../api/projects.ts";
import { UnauthorizedError } from "../backend.ts";
import { CrudScreen } from "./crud-screen.ts";
import { Form } from "./form.ts";
import { ProjectDetailScreen } from "./project-detail-screen.ts";
import type { ChatProgressEvent } from "./progress-client.ts";
import { STATUS_LABEL } from "./project-status.ts";
import { c, theme } from "./theme.ts";

const h = React.createElement;

const ProjectCrudScreen = CrudScreen as unknown as (props: {
    title: string;
    items: ProjectSummary[] | undefined;
    itemLabel: (item: ProjectSummary) => { label: string; hint?: string };
    onSelect: (item: ProjectSummary) => void;
    onCreate: () => void;
    busy: boolean;
    error?: string;
    onExit: () => void;
}) => React.ReactElement;

interface PersonaItem {
    id: string;
    label: string;
}

const PersonaCrudScreen = CrudScreen as unknown as (props: {
    title: string;
    items: PersonaItem[] | undefined;
    itemLabel: (item: PersonaItem) => { label: string; hint?: string };
    onSelect: (item: PersonaItem) => void;
    onDelete: (item: PersonaItem) => Promise<void>;
    deleteConfirmLabel: (item: PersonaItem) => string;
    busy: boolean;
    error?: string;
    onExit: () => void;
}) => React.ReactElement;

function projectLabel(project: ProjectSummary): { label: string; hint: string } {
    const spec = project.spec.length > 60 ? `${project.spec.slice(0, 60)}...` : project.spec;
    return { label: spec, hint: STATUS_LABEL[project.status] };
}

const AUTONOMY_LABELS: Record<AutonomyDecision, string> = {
    qa_failure: "QA falhou — pausar pra revisão manual ou seguir sozinha?",
    revision_scope_change: "Revisão saiu do escopo pedido — pausar ou seguir sozinha?",
};

type ScreenState =
    | { kind: "list" }
    | { kind: "detail"; project: ProjectSummary }
    | { kind: "create" }
    | { kind: "autonomy" }
    | { kind: "personas" }
    | { kind: "persona-rename"; role: string; currentName: string };

/** `/projetos` — a tela mais complexa da CLI: lista, criar, políticas de autonomia (tecla `a`), nomes da equipe (tecla `p`), e detalhe de um Project (steps, custo, ações, conversa por agente). */
export function ProjectsScreen(props: {
    backendUrl: string;
    token: string;
    onExit: () => void;
    onUnauthorized: () => void;
    subscribeProgress: (fn: (event: ChatProgressEvent) => void) => () => void;
}): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized, subscribeProgress } = props;
    const [projects, setProjects] = React.useState<ProjectSummary[] | undefined>(undefined);
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
            setProjects(await listProjects(backendUrl, token));
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
        if (input === "a") setScreen({ kind: "autonomy" });
        else if (input === "p") setScreen({ kind: "personas" });
    });

    if (error) {
        return h(Box, { flexDirection: "column", borderStyle: "round", borderColor: theme.danger, paddingX: 1 }, h(Text, { color: theme.danger }, `Erro: ${error}`), h(Text, { dimColor: true }, "Esc pra voltar ao chat"));
    }

    async function handleCreate(values: Record<string, string>): Promise<void> {
        const spec = values.spec?.trim();
        if (!spec) {
            setError("Descrição do Project não pode ficar vazia.");
            return;
        }
        setBusy(true);
        try {
            const outcome = await createProject(backendUrl, token, {
                spec,
                machine: values.machine?.trim() || undefined,
                costCapValue: values.costCapValue?.trim() ? Number.parseFloat(values.costCapValue) : undefined,
                gitPushAllowed: values.gitPushAllowed?.trim().toLowerCase() === "s",
            });
            // HTTP 201 não significa sucesso aqui — o backend devolve {error} (ex: nenhuma máquina conectada) com status 201 mesmo assim (ver CreateProjectOutcome em api/projects.ts).
            if (outcome.error) {
                setError(outcome.error);
                return;
            }
            setScreen({ kind: "list" });
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (screen.kind === "detail") {
        return h(ProjectDetailScreen, {
            backendUrl,
            token,
            project: screen.project,
            onUnauthorized,
            onBack: () => {
                setScreen({ kind: "list" });
                void reload();
            },
            subscribeProgress,
        });
    }

    if (screen.kind === "create") {
        return h(Form, {
            title: "Novo Project",
            fields: [
                { key: "spec", label: "Descrição (o que a equipe deve construir)" },
                { key: "machine", label: "Máquina (opcional, nome livre)", optional: true },
                { key: "costCapValue", label: "Teto de custo em tokens (opcional)", optional: true },
                { key: "gitPushAllowed", label: "Pode dar git push sozinha? (s/n)", initialValue: "n" },
            ],
            onSubmit: (values) => void handleCreate(values),
            onCancel: () => setScreen({ kind: "list" }),
            busy,
            error,
        });
    }

    if (screen.kind === "autonomy") {
        return h(AutonomyScreen, { backendUrl, token, onUnauthorized, onBack: () => setScreen({ kind: "list" }) });
    }

    if (screen.kind === "personas" || screen.kind === "persona-rename") {
        return h(PersonasScreen, {
            backendUrl,
            token,
            onUnauthorized,
            screen,
            setScreen,
        });
    }

    return h(ProjectCrudScreen, {
        title: "Projetos — a: políticas de autonomia · p: nomes da equipe",
        items: projects,
        itemLabel: projectLabel,
        onSelect: (project) => setScreen({ kind: "detail", project }),
        onCreate: () => setScreen({ kind: "create" }),
        busy,
        onExit,
    });
}

function AutonomyScreen(props: { backendUrl: string; token: string; onUnauthorized: () => void; onBack: () => void }): React.ReactElement {
    const { backendUrl, token, onUnauthorized, onBack } = props;
    const [policies, setPolicies] = React.useState<Record<AutonomyDecision, AutonomyMode> | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);

    const reload = React.useCallback(async () => {
        try {
            setPolicies(await listAutonomyPolicies(backendUrl, token));
        } catch (err) {
            if (err instanceof UnauthorizedError) {
                onUnauthorized();
                return;
            }
            setError(err instanceof Error ? err.message : String(err));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    useInput((input, key) => {
        if (busy || !policies) return;
        if (key.escape) {
            onBack();
            return;
        }
        const decisions: AutonomyDecision[] = ["qa_failure", "revision_scope_change"];
        const index = "12".indexOf(input);
        if (index !== -1) void toggle(decisions[index]!);
    });

    async function toggle(decision: AutonomyDecision): Promise<void> {
        if (!policies) return;
        const next: AutonomyMode = policies[decision] === "auto" ? "ask" : "auto";
        setBusy(true);
        try {
            setPolicies(await setAutonomyPolicy(backendUrl, token, decision, next));
        } catch (err) {
            if (err instanceof UnauthorizedError) {
                onUnauthorized();
                return;
            }
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }

    if (error) return h(Text, { color: theme.danger }, `Erro: ${error} — Esc volta`);
    if (!policies) return h(Text, { dimColor: true }, "Carregando políticas...");

    const decisions: AutonomyDecision[] = ["qa_failure", "revision_scope_change"];
    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
        h(Text, { bold: true, color: theme.primary }, "Políticas de autonomia"),
        h(Text, { dimColor: true }, "Quando a equipe de dev topa decidir sozinha, e quando prefere te perguntar."),
        h(Box, { marginTop: 1 }),
        ...decisions.map((decision, i) => {
            const mode = policies[decision];
            const modeLabel = mode === "auto" ? c.success("decide sozinha") : c.warning("pergunta antes");
            return h(Text, { key: decision }, `${i + 1}) ${AUTONOMY_LABELS[decision]}  `, modeLabel);
        }),
        h(Box, { marginTop: 1 }),
        h(Text, { dimColor: true }, busy ? "aplicando..." : "1-2 alterna · Esc volta"),
    );
}

function PersonasScreen(props: {
    backendUrl: string;
    token: string;
    onUnauthorized: () => void;
    screen: Extract<ScreenState, { kind: "personas" | "persona-rename" }>;
    setScreen: (s: ScreenState) => void;
}): React.ReactElement {
    const { backendUrl, token, onUnauthorized, screen, setScreen } = props;
    const [personas, setPersonas] = React.useState<Record<string, string> | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) {
            onUnauthorized();
            return;
        }
        setError(err instanceof Error ? err.message : String(err));
    }

    const reload = React.useCallback(async () => {
        try {
            setPersonas(await listAgentPersonas(backendUrl, token));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    if (error) return h(Text, { color: theme.danger }, `Erro: ${error} — Esc volta`);

    async function handleReset(role: string): Promise<void> {
        setBusy(true);
        try {
            setPersonas(await resetAgentPersona(backendUrl, token, role));
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleRename(role: string, name: string): Promise<void> {
        const trimmed = name.trim();
        if (!trimmed) {
            setError("Nome não pode ficar vazio.");
            return;
        }
        setBusy(true);
        try {
            setPersonas(await setAgentPersonaName(backendUrl, token, role, trimmed));
            setScreen({ kind: "personas" });
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (screen.kind === "persona-rename") {
        return h(Form, {
            title: `Renomear ${screen.role}`,
            fields: [{ key: "name", label: "Nome", initialValue: screen.currentName }],
            onSubmit: (values) => void handleRename(screen.role, values.name ?? ""),
            onCancel: () => setScreen({ kind: "personas" }),
            busy,
            error,
        });
    }

    if (!personas) return h(Text, { dimColor: true }, "Carregando nomes da equipe...");

    const items: PersonaItem[] = AGENT_ROLES.map((role) => ({ id: role, label: `${personas[role] ?? DEFAULT_AGENT_NAMES[role]} (${role})` }));

    return h(PersonaCrudScreen, {
        title: "Nomes da equipe — Enter renomeia, x restaura o padrão",
        items,
        itemLabel: (item) => ({ label: item.label }),
        onSelect: (item) => setScreen({ kind: "persona-rename", role: item.id, currentName: personas[item.id] ?? DEFAULT_AGENT_NAMES[item.id as keyof typeof DEFAULT_AGENT_NAMES] }),
        onDelete: (item) => handleReset(item.id),
        deleteConfirmLabel: (item) => `Restaurar "${DEFAULT_AGENT_NAMES[item.id as keyof typeof DEFAULT_AGENT_NAMES]}" como nome de ${item.id}? (reversível — dá pra renomear de novo depois)`,
        busy,
        onExit: () => setScreen({ kind: "list" }),
    });
}
