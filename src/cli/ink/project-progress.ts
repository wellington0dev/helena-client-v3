import type { ProjectStepRole, ProjectStepStatus } from "./progress-client.ts";

/** Mesmos rótulos/ordem de panel-app/src/app/pages/project-detail/project-detail.component.ts — o dono vê o mesmo vocabulário no painel e no CLI. Só os papéis "clássicos" têm rótulo pré-definido — um papel inventado na hora (ver §14 do doc de arquitetura do backend-v2) cai no fallback capitalizado. */
const ROLE_LABEL: Partial<Record<ProjectStepRole, string>> = {
    architect: "Arquiteta",
    designer: "Designer",
    frontend: "Frontend",
    backend: "Backend",
    dba: "DBA",
    security: "Segurança",
    qa: "QA",
};

/** Ordem fixa dos papéis clássicos — qualquer papel dinâmico (fora desta lista) aparece DEPOIS, na ordem em que foi descoberto (ver formatProjectChecklist). */
const ROLE_ORDER: ProjectStepRole[] = ["architect", "designer", "frontend", "backend", "dba", "security", "qa"];

const STATUS_ICON: Record<ProjectStepStatus, string> = { ready: "○", running: "◐", done: "✓", failed: "✗" };
const STATUS_LABEL: Record<ProjectStepStatus, string> = { ready: "na fila", running: "rodando", done: "concluído", failed: "falhou" };

function roleLabelFor(role: ProjectStepRole): string {
    return ROLE_LABEL[role] ?? (role.length > 0 ? role[0]!.toUpperCase() + role.slice(1) : role);
}

export type ProjectStepsByRole = Partial<Record<ProjectStepRole, ProjectStepStatus>>;

/** Uma linha por step — papéis clássicos na ordem fixa primeiro, seguidos de qualquer papel DINÂMICO (na ordem em que apareceu no objeto) — nunca escondido só por não estar no catálogo fixo. Pura (sem Ink/React) pra testar sem precisar montar componente. */
export function formatProjectChecklist(steps: ProjectStepsByRole): string[] {
    const knownRoles = ROLE_ORDER.filter((role) => steps[role] !== undefined);
    const dynamicRoles = Object.keys(steps).filter((role) => !ROLE_ORDER.includes(role));
    return [...knownRoles, ...dynamicRoles].map((role) => {
        const status = steps[role]!;
        return `${STATUS_ICON[status]} ${roleLabelFor(role)} (${STATUS_LABEL[status]})`;
    });
}

/** "2 de 5 concluídos" — cabeçalho do checklist. Falhou conta como "terminado" pro denominador de progresso, mas aparece separado do resto do texto (ver formatProjectChecklist) porque é um resultado diferente de "concluído". */
export function formatProjectSummary(steps: ProjectStepsByRole): string {
    const values = Object.values(steps) as ProjectStepStatus[];
    const finished = values.filter((s) => s === "done" || s === "failed").length;
    return `${finished} de ${values.length} terminados`;
}
