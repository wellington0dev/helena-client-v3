import type { ProjectStatus, ProjectStep } from "../api/projects.ts";
import { ROLE_ORDER } from "./project-progress.ts";

/** Papéis clássicos primeiro (ordem fixa), papéis dinâmicos depois na ordem em que vieram — mesma regra de `formatProjectChecklist`, mas operando na lista completa de `ProjectStep` (com relatório/instrução/custo), não só no mapa role→status. */
export function orderSteps(steps: ProjectStep[]): ProjectStep[] {
    const byRole = new Map(steps.map((step) => [step.role, step]));
    const known = ROLE_ORDER.filter((role) => byRole.has(role)).map((role) => byRole.get(role)!);
    const dynamic = steps.filter((step) => !ROLE_ORDER.includes(step.role));
    return [...known, ...dynamic];
}

/** Guardas de quais ações fazem sentido em cada status — mesmas regras de `panel-app/src/app/pages/projects/projects.component.ts`. Funções puras testáveis, evitam duplicar a lógica em cada botão/atalho da tela. */
const TERMINAL_STATUSES: ProjectStatus[] = ["completed", "cancelled"];

export function canRequestRevision(status: ProjectStatus): boolean {
    return status === "completed";
}

export function canResume(status: ProjectStatus): boolean {
    return status === "paused";
}

export function canCancel(status: ProjectStatus): boolean {
    return !TERMINAL_STATUSES.includes(status);
}

export function isTerminal(status: ProjectStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
}

/**
 * Apagar agora é sempre oferecido — achado ao vivo (2026-09-21): o dono tinha Projects presos em "planning" (nunca
 * chegaram a terminar) sem NENHUM jeito de removê-los, já que apagar exigia status terminal. Continua exigindo
 * cancelar primeiro (`ProjectsService#remove`), mas isso agora acontece automaticamente como parte da mesma ação —
 * ver `deleteConfirmText` (avisa quando vai cancelar) e o `handleDelete` que primeiro cancela se preciso.
 */
export function canDelete(_status: ProjectStatus): boolean {
    return true;
}

/** Preview de até 60 chars — mesmo corte usado noutras listas (ver session-preview.ts no backend). */
function previewSpec(spec: string): string {
    return spec.length > 60 ? `${spec.slice(0, 59)}…` : spec;
}

/** Mensagem de confirmação de apagar — muda quando o Project ainda não terminou, pra deixar claro que um cancelamento acontece junto. */
export function deleteConfirmText(status: ProjectStatus, spec: string): string {
    const preview = previewSpec(spec);
    if (isTerminal(status)) return `Apagar PERMANENTEMENTE "${preview}"? Essa ação não pode ser desfeita.`;
    return `Este Project ainda está "${STATUS_LABEL[status]}" — apagar vai CANCELAR e depois apagar "${preview}" PERMANENTEMENTE. Essa ação não pode ser desfeita.`;
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
    draft: "rascunho",
    planning: "planejando",
    active: "ativo",
    paused: "pausado",
    needs_revision: "precisa de revisão",
    completed: "concluído",
    cancelled: "cancelado",
};
