import type { ProjectStep } from "../api/projects.ts";

/** Não existe endpoint de custo agregado por Project — somar client-side, mesmo que o backend faz internamente (`ProjectsService#sumTokensSpent`, uso interno, sem rota HTTP). */
export function sumTokensSpent(steps: ProjectStep[]): number {
    return steps.reduce((total, step) => total + (step.tokensSpentEstimate ?? 0), 0);
}
