import { authed } from "./http.ts";
import type { ProjectStepRole, ProjectStepStatus } from "../ink/progress-client.ts";

/** Espelha `dev-team/projects.controller.ts` — ver `backend-v2/docs/rest-api-reference.md#projetos--equipe-de-dev-projects-agent-personas`. */
export type ProjectStatus = "draft" | "planning" | "active" | "paused" | "needs_revision" | "completed" | "cancelled";
export type { ProjectStepStatus };
export type AutonomyDecision = "qa_failure" | "revision_scope_change";
export type AutonomyMode = "auto" | "ask";

export interface ProjectSummary {
    id: string;
    spec: string;
    status: ProjectStatus;
    machine?: string;
    costCapEnabled: boolean;
    costCapValue?: number;
    gitPushAllowed: boolean;
    executionMode: string;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectStep {
    role: ProjectStepRole;
    focus?: string;
    status: ProjectStepStatus;
    sessionId?: string;
    instruction?: string;
    report?: string;
    ok?: boolean;
    tokensSpentEstimate?: number;
    startedAt?: string;
    finishedAt?: string;
}

export interface ProjectEvent {
    kind: string;
    note: string;
    createdAt: string;
}

export interface ProjectDetail {
    project: ProjectSummary;
    steps: ProjectStep[];
    events: ProjectEvent[];
}

export interface StepTranscriptPart {
    text?: string;
    reasoning?: string;
    toolRequest?: unknown;
    toolResponse?: unknown;
}

export interface StepTranscriptMessage {
    role: string;
    parts: StepTranscriptPart[];
}

export interface StepTranscript {
    error?: string;
    status?: string;
    messages: StepTranscriptMessage[];
}

export interface CreateProjectInput {
    spec: string;
    machine?: string;
    costCapValue?: number;
    gitPushAllowed?: boolean;
    requireApprovalBeforeExecution?: boolean;
}

/**
 * `HTTP 201` não significa sucesso aqui — o backend devolve `{error}` (ex: nenhuma máquina conectada) com status 201
 * mesmo assim. Sempre checar `.error` antes de considerar que criou.
 *
 * Desde §16 (2026-09-22, backend-v2/docs/agent-team-architecture.md): a Arquiteta despacha em BACKGROUND — esta
 * chamada devolve só `projectId` assim que o Project é criado, `plan`/`executionMode` NUNCA vêm preenchidos aqui
 * (ficam `undefined` pra sempre nesta resposta). O plano em si chega depois via evento de Project (painel/WhatsApp/
 * Telegram) — pra ver o plano no painel, recarregue o detalhe do Project (`getProject`) depois de pronto.
 */
export interface CreateProjectOutcome {
    projectId?: string;
    plan?: string;
    executionMode?: string;
    error?: string;
}

export function listProjects(baseUrl: string, token: string): Promise<ProjectSummary[]> {
    return authed(baseUrl, token, "GET", "/projects");
}

/** Rota fixa — precisa ser chamada com esse path exato, nunca `/projects/autonomy-policies` tratado como um `:id`. */
export function listAutonomyPolicies(baseUrl: string, token: string): Promise<Record<AutonomyDecision, AutonomyMode>> {
    return authed(baseUrl, token, "GET", "/projects/autonomy-policies");
}

export function setAutonomyPolicy(baseUrl: string, token: string, decision: AutonomyDecision, mode: AutonomyMode): Promise<Record<AutonomyDecision, AutonomyMode>> {
    return authed(baseUrl, token, "PATCH", `/projects/autonomy-policies/${decision}`, { mode });
}

export function getProject(baseUrl: string, token: string, id: string): Promise<ProjectDetail> {
    return authed(baseUrl, token, "GET", `/projects/${id}`);
}

export function createProject(baseUrl: string, token: string, input: CreateProjectInput): Promise<CreateProjectOutcome> {
    return authed(baseUrl, token, "POST", "/projects", input);
}

export function requestRevision(baseUrl: string, token: string, id: string, roles: string[], note: string): Promise<{ ok: boolean; error?: string }> {
    return authed(baseUrl, token, "POST", `/projects/${id}/revision`, { roles, note });
}

export function resumeProject(baseUrl: string, token: string, id: string): Promise<{ ok: boolean; error?: string }> {
    return authed(baseUrl, token, "POST", `/projects/${id}/resume`);
}

/** `interrupted` (quando `ok`) — quantos agentes estavam rodando de verdade agora e foram interrompidos na hora (ver `RunningStepsRegistry` no backend). 0 = nenhum estava em execução. */
export function cancelProject(baseUrl: string, token: string, id: string, reason?: string): Promise<{ ok: boolean; error?: string; interrupted?: number }> {
    return authed(baseUrl, token, "POST", `/projects/${id}/cancel`, { reason });
}

/** `null` em `costCapValue` desliga o teto. Funciona em qualquer status (nunca `spec`/`rootDirectory`/`machine` — ver o DTO no backend). */
export interface UpdateProjectInput {
    costCapValue?: number | null;
    gitPushAllowed?: boolean;
    requireApprovalBeforeExecution?: boolean;
}

export function updateProject(baseUrl: string, token: string, id: string, patch: UpdateProjectInput): Promise<ProjectSummary> {
    return authed(baseUrl, token, "PATCH", `/projects/${id}`, patch);
}

export function deleteProject(baseUrl: string, token: string, id: string): Promise<{ ok: boolean; error?: string }> {
    return authed(baseUrl, token, "DELETE", `/projects/${id}`);
}

export function getStepMessages(baseUrl: string, token: string, id: string, role: ProjectStepRole): Promise<StepTranscript> {
    return authed(baseUrl, token, "GET", `/projects/${id}/steps/${encodeURIComponent(role)}/messages`);
}

export function sendStepMessage(baseUrl: string, token: string, id: string, role: ProjectStepRole, message: string): Promise<{ error?: string }> {
    return authed(baseUrl, token, "POST", `/projects/${id}/steps/${encodeURIComponent(role)}/message`, { message });
}
