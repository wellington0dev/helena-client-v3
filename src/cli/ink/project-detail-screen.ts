import React from "react";
import { Box, Text, useInput } from "ink";
import {
    cancelProject,
    deleteProject,
    getProject,
    getStepMessages,
    requestRevision,
    resumeProject,
    sendStepMessage,
    updateProject,
    type ProjectDetail,
    type ProjectStep,
    type ProjectSummary,
    type StepTranscript,
} from "../api/projects.ts";
import { UnauthorizedError } from "../backend.ts";
import { Form } from "./form.ts";
import { sumTokensSpent } from "./project-cost.ts";
import { roleLabelFor } from "./project-progress.ts";
import type { ChatProgressEvent } from "./progress-client.ts";
import { canCancel, canDelete, canRequestRevision, canResume, deleteConfirmText, isTerminal, orderSteps, STATUS_LABEL } from "./project-status.ts";
import { c, theme, panel } from "./theme.ts";

const h = React.createElement;

const STEP_STATUS_ICON: Record<ProjectStep["status"], string> = { ready: "○", running: "◐", done: "✓", failed: "✗" };
const STEP_STATUS_LABEL: Record<ProjectStep["status"], string> = { ready: "na fila", running: "rodando", done: "concluído", failed: "falhou" };
/** Só o step JÁ PARADO (nunca `running`) aceita mensagem nova — mesma regra do painel (`IDLE_STATUSES`). */
const IDLE_STEP_STATUSES: ProjectStep["status"][] = ["done", "failed"];

type DetailScreenState =
    | { kind: "overview" }
    | { kind: "step"; role: string }
    | { kind: "revision-form" }
    | { kind: "cancel-form" }
    | { kind: "edit-form" }
    | { kind: "confirm-delete" };

export function ProjectDetailScreen(props: {
    backendUrl: string;
    token: string;
    project: ProjectSummary;
    onUnauthorized: () => void;
    onBack: () => void;
    subscribeProgress: (fn: (event: ChatProgressEvent) => void) => () => void;
}): React.ReactElement {
    const { backendUrl, token, project, onUnauthorized, onBack, subscribeProgress } = props;
    const [detail, setDetail] = React.useState<ProjectDetail | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [screen, setScreen] = React.useState<DetailScreenState>({ kind: "overview" });
    const [cursor, setCursor] = React.useState(0);

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) {
            onUnauthorized();
            return;
        }
        setError(err instanceof Error ? err.message : String(err));
    }

    const reload = React.useCallback(async () => {
        try {
            setDetail(await getProject(backendUrl, token, project.id));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token, project.id]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    // O WS só carrega {projectId, role, status} — nunca dado completo (report/instrução/custo) — serve só de GATILHO pra recarregar via REST, nunca como fonte direta.
    React.useEffect(() => {
        return subscribeProgress((event: ChatProgressEvent) => {
            if ((event.type === "project_step" || event.type === "project_event") && event.projectId === project.id) {
                void reload();
            }
        });
    }, [subscribeProgress, project.id, reload]);

    const steps = detail ? orderSteps(detail.steps) : [];

    useInput((input, key) => {
        if (screen.kind !== "overview" || busy) return;
        if (key.escape) {
            onBack();
            return;
        }
        if (key.upArrow) {
            setCursor((i) => (i - 1 + Math.max(steps.length, 1)) % Math.max(steps.length, 1));
            return;
        }
        if (key.downArrow) {
            setCursor((i) => (i + 1) % Math.max(steps.length, 1));
            return;
        }
        if (key.return && steps[cursor]) {
            setScreen({ kind: "step", role: steps[cursor]!.role });
            return;
        }
        const digitIndex = "123456789".indexOf(input);
        if (digitIndex !== -1 && steps[digitIndex]) {
            setScreen({ kind: "step", role: steps[digitIndex]!.role });
            return;
        }
        if (input === "v" && canRequestRevision(project.status)) setScreen({ kind: "revision-form" });
        else if (input === "u" && canResume(project.status)) void handleResume();
        else if (input === "c" && canCancel(project.status)) setScreen({ kind: "cancel-form" });
        else if (input === "e") setScreen({ kind: "edit-form" });
        else if (input === "x" && canDelete(project.status)) setScreen({ kind: "confirm-delete" });
    });

    async function handleResume(): Promise<void> {
        setBusy(true);
        try {
            const result = await resumeProject(backendUrl, token, project.id);
            if (result.error) setError(result.error);
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleRevision(values: Record<string, string>): Promise<void> {
        const roles = (values.roles ?? "")
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);
        const note = values.note?.trim();
        if (roles.length === 0 || !note) {
            setError("Preencha os papéis (separados por vírgula) e a nota.");
            return;
        }
        setBusy(true);
        try {
            const result = await requestRevision(backendUrl, token, project.id, roles, note);
            if (result.error) setError(result.error);
            setScreen({ kind: "overview" });
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleCancel(values: Record<string, string>): Promise<void> {
        setBusy(true);
        try {
            const result = await cancelProject(backendUrl, token, project.id, values.reason?.trim() || undefined);
            if (result.error) setError(result.error);
            setScreen({ kind: "overview" });
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleEdit(values: Record<string, string>): Promise<void> {
        setBusy(true);
        try {
            const rawCap = values.costCap?.trim() ?? "";
            const costCapValue = rawCap === "" ? null : Number(rawCap);
            if (rawCap !== "" && (!Number.isFinite(costCapValue) || costCapValue! <= 0)) {
                setError("Teto de custo precisa ser um número positivo (ou vazio, pra desligar).");
                return;
            }
            const gitPush = values.gitPush?.trim().toLowerCase();
            const requireApproval = values.requireApproval?.trim().toLowerCase();
            await updateProject(backendUrl, token, project.id, {
                costCapValue,
                ...(gitPush === "s" || gitPush === "n" ? { gitPushAllowed: gitPush === "s" } : {}),
                ...(requireApproval === "s" || requireApproval === "n" ? { requireApprovalBeforeExecution: requireApproval === "s" } : {}),
            });
            setScreen({ kind: "overview" });
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleDelete(): Promise<void> {
        setBusy(true);
        try {
            // Não terminal: cancela primeiro (ProjectsService#remove exige status terminal) — a confirmação já avisou isso.
            if (!isTerminal(project.status)) {
                const cancelResult = await cancelProject(backendUrl, token, project.id, "Apagado pelo dono antes de terminar.");
                if (cancelResult.error) {
                    setError(cancelResult.error);
                    setScreen({ kind: "overview" });
                    return;
                }
            }
            const result = await deleteProject(backendUrl, token, project.id);
            if (result.error) {
                setError(result.error);
                setScreen({ kind: "overview" });
                return;
            }
            onBack();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (error) {
        return h(Box, { flexDirection: "column", ...panel("danger") }, h(Text, { color: theme.danger }, `Erro: ${error}`), h(Text, { color: theme.textMuted }, "Esc volta pra visão geral (Esc de novo sai)"));
    }
    if (!detail) {
        return h(Text, { color: theme.textMuted }, "Carregando Project...");
    }

    if (screen.kind === "step") {
        const step = steps.find((s) => s.role === screen.role);
        if (!step) {
            return h(FallbackBack, { message: "Step não encontrado.", onBack: () => setScreen({ kind: "overview" }) });
        }
        return h(StepScreen, {
            backendUrl,
            token,
            projectId: project.id,
            step,
            onUnauthorized,
            onBack: () => setScreen({ kind: "overview" }),
        });
    }

    if (screen.kind === "revision-form") {
        return h(Form, {
            title: "Pedir revisão",
            fields: [
                { key: "roles", label: "Papéis (separados por vírgula, ex: frontend,qa)" },
                { key: "note", label: "O que precisa mudar" },
            ],
            onSubmit: (values) => void handleRevision(values),
            onCancel: () => setScreen({ kind: "overview" }),
            busy,
        });
    }

    if (screen.kind === "cancel-form") {
        return h(Form, {
            title: "Cancelar Project",
            fields: [{ key: "reason", label: "Motivo (opcional)", optional: true }],
            onSubmit: (values) => void handleCancel(values),
            onCancel: () => setScreen({ kind: "overview" }),
            busy,
        });
    }

    if (screen.kind === "edit-form") {
        return h(Form, {
            title: "Editar Project",
            description: ["Só ajustes operacionais — pra mudar o que o Project FAZ, cancele e crie outro.", "Deixe um campo em branco pra não mudar (teto de custo em branco = desliga o teto)."],
            fields: [
                { key: "costCap", label: "Teto de custo (R$)", initialValue: project.costCapValue != null ? String(project.costCapValue) : "", optional: true },
                { key: "gitPush", label: "Permitir git push (s/n)", initialValue: "", optional: true },
                { key: "requireApproval", label: "Exigir aprovação antes de executar (s/n)", initialValue: "", optional: true },
            ],
            onSubmit: (values) => void handleEdit(values),
            onCancel: () => setScreen({ kind: "overview" }),
            busy,
            error,
        });
    }

    if (screen.kind === "confirm-delete") {
        return h(ConfirmPrompt, {
            message: deleteConfirmText(project.status, project.spec),
            busy,
            onAnswer: (yes: boolean) => (yes ? void handleDelete() : setScreen({ kind: "overview" })),
        });
    }

    const cost = sumTokensSpent(detail.steps);
    const hints: string[] = [];
    if (canRequestRevision(project.status)) hints.push("v pede revisão");
    if (canResume(project.status)) hints.push("u retoma");
    if (canCancel(project.status)) hints.push("c cancela");
    hints.push("e edita");
    if (canDelete(project.status)) hints.push("x apaga");

    return h(
        Box,
        { flexDirection: "column", ...panel("border") },
        h(Text, { bold: true, color: theme.primary }, detail.project.spec),
        h(Text, { color: theme.textMuted }, `Status: ${STATUS_LABEL[project.status]} · Custo estimado: ${cost.toLocaleString("pt-BR")} tokens${project.machine ? ` · Máquina: ${project.machine}` : ""}`),
        h(Box, { marginTop: 1 }),
        h(Text, { color: theme.textMuted }, "Equipe:"),
        ...steps.map((step, i) => {
            const active = i === cursor;
            const pointer = active ? c.primary("❯ ") : "  ";
            const number = i < 9 ? c.muted(`${i + 1}) `) : "   ";
            const label = `${STEP_STATUS_ICON[step.status]} ${roleLabelFor(step.role)}`;
            const tokens = step.tokensSpentEstimate ? c.muted(`  ${step.tokensSpentEstimate.toLocaleString("pt-BR")} tokens`) : "";
            return h(Text, { key: step.role }, pointer, number, active ? c.primary(label) : label, tokens);
        }),
        h(Box, { marginTop: 1 }),
        h(Text, { color: theme.textMuted }, busy ? "aplicando..." : `1-9/↑↓+Enter abre a conversa do agente${hints.length ? ` · ${hints.join(" · ")}` : ""} · Esc volta`),
    );
}

/** Fallback defensivo (não deveria acontecer em uso normal — ver comentário no call site) que ainda assim reage a Esc, nunca deixa o dono preso numa tela morta. */
function FallbackBack(props: { message: string; onBack: () => void }): React.ReactElement {
    useInput((_input, key) => {
        if (key.escape) props.onBack();
    });
    return h(Text, { color: theme.textMuted }, `${props.message} Esc volta.`);
}

function ConfirmPrompt(props: { message: string; busy: boolean; onAnswer: (yes: boolean) => void }): React.ReactElement {
    useInput((input) => {
        if (props.busy) return;
        const normalized = input.trim().toLowerCase();
        if (normalized === "s") props.onAnswer(true);
        else if (normalized === "n") props.onAnswer(false);
    });
    return h(
        Box,
        { flexDirection: "column", ...panel("warning") },
        h(Text, { bold: true, color: theme.warning }, props.message),
        h(Text, null, props.busy ? "aplicando..." : "Confirmar? (s/n)"),
    );
}

/** Transcrição de UM agente/papel — só aceita mensagem nova quando o step está PARADO (done/failed), nunca `running`. */
function StepScreen(props: { backendUrl: string; token: string; projectId: string; step: ProjectStep; onUnauthorized: () => void; onBack: () => void }): React.ReactElement {
    const { backendUrl, token, projectId, step, onUnauthorized, onBack } = props;
    const [transcript, setTranscript] = React.useState<StepTranscript | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [composing, setComposing] = React.useState(false);

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) {
            onUnauthorized();
            return;
        }
        setError(err instanceof Error ? err.message : String(err));
    }

    const reload = React.useCallback(async () => {
        try {
            setTranscript(await getStepMessages(backendUrl, token, projectId, step.role));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token, projectId, step.role]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    const isIdle = IDLE_STEP_STATUSES.includes(step.status);

    useInput((input, key) => {
        if (composing || busy) return;
        if (key.escape) {
            onBack();
            return;
        }
        if (input === "m" && isIdle) setComposing(true);
    });

    async function handleSend(values: Record<string, string>): Promise<void> {
        const message = values.message?.trim();
        if (!message) return;
        setBusy(true);
        try {
            const result = await sendStepMessage(backendUrl, token, projectId, step.role, message);
            if (result.error) setError(result.error);
            setComposing(false);
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (composing) {
        return h(Form, {
            title: `Mensagem pra ${roleLabelFor(step.role)}`,
            fields: [{ key: "message", label: "Mensagem" }],
            onSubmit: (values) => void handleSend(values),
            onCancel: () => setComposing(false),
            busy,
            error,
        });
    }

    if (!transcript) return h(Text, { color: theme.textMuted }, "Carregando conversa...");

    return h(
        Box,
        { flexDirection: "column", ...panel("border") },
        h(Text, { bold: true, color: theme.primary }, `${roleLabelFor(step.role)} — ${STEP_STATUS_LABEL[step.status]}`),
        transcript.error ? h(Text, { color: theme.danger }, transcript.error) : null,
        h(Box, { marginTop: 1, flexDirection: "column" }, ...transcript.messages.map((msg, i) => h(TranscriptLine, { key: i, msg }))),
        h(Box, { marginTop: 1 }),
        error ? h(Text, { color: theme.danger }, `Erro: ${error}`) : null,
        h(Text, { color: theme.textMuted }, isIdle ? "m manda mensagem · Esc volta" : "Agente ainda rodando — não dá pra mandar mensagem agora · Esc volta"),
    );
}

function TranscriptLine(props: { msg: { role: string; parts: { text?: string; reasoning?: string }[] } }): React.ReactElement {
    const { msg } = props;
    const text = msg.parts
        .map((p) => p.text ?? (p.reasoning ? c.muted(`(raciocínio) ${p.reasoning}`) : ""))
        .filter(Boolean)
        .join("\n");
    const label = msg.role === "user" ? c.primary.bold("Dono") : c.accent.bold("Agente");
    return h(Box, { flexDirection: "column", marginBottom: 1 }, h(Text, null, `${label}:`), h(Text, null, text || c.muted("(sem texto)")));
}
