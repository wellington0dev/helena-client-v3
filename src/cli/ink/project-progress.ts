import type { ProjectStepRole, ProjectStepStatus } from "./progress-client.ts";

/** Mesmos rótulos/ordem de panel-app/src/app/pages/project-detail/project-detail.component.ts — o dono vê o mesmo vocabulário no painel e no CLI. */
const ROLE_LABEL: Record<ProjectStepRole, string> = {
    architect: "Arquiteta",
    designer: "Designer",
    frontend: "Frontend",
    backend: "Backend",
    dba: "DBA",
    security: "Segurança",
    qa: "QA",
};

const ROLE_ORDER: ProjectStepRole[] = ["architect", "designer", "frontend", "backend", "dba", "security", "qa"];

const STATUS_ICON: Record<ProjectStepStatus, string> = { ready: "○", running: "◐", done: "✓", failed: "✗" };
const STATUS_LABEL: Record<ProjectStepStatus, string> = { ready: "na fila", running: "rodando", done: "concluído", failed: "falhou" };

export type ProjectStepsByRole = Partial<Record<ProjectStepRole, ProjectStepStatus>>;

/** Uma linha por step, na ordem fixa de exibição — só os papéis que este Project realmente tem (mesmo filtro do painel). Pura (sem Ink/React) pra testar sem precisar montar componente. */
export function formatProjectChecklist(steps: ProjectStepsByRole): string[] {
    return ROLE_ORDER.filter((role) => steps[role] !== undefined).map((role) => {
        const status = steps[role]!;
        return `${STATUS_ICON[status]} ${ROLE_LABEL[role]} (${STATUS_LABEL[status]})`;
    });
}

/** "2 de 5 concluídos" — cabeçalho do checklist. Falhou conta como "terminado" pro denominador de progresso, mas aparece separado do resto do texto (ver formatProjectChecklist) porque é um resultado diferente de "concluído". */
export function formatProjectSummary(steps: ProjectStepsByRole): string {
    const values = Object.values(steps) as ProjectStepStatus[];
    const finished = values.filter((s) => s === "done" || s === "failed").length;
    return `${finished} de ${values.length} terminados`;
}
