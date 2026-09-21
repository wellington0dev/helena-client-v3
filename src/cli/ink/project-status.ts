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

export function canDelete(status: ProjectStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
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
