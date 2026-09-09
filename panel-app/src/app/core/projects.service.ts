import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";

export type ProjectStatus = "draft" | "planning" | "active" | "paused" | "needs_revision" | "completed" | "cancelled";
export type ExecutionMode = "parallel" | "throttled";
export type ProjectStepRole = "architect" | "designer" | "frontend" | "backend" | "dba" | "security" | "qa";
export type ProjectStepStatus = "ready" | "running" | "done" | "failed";
export type AutonomyDecision = "qa_failure" | "revision_scope_change";
export type AutonomyMode = "auto" | "ask";

/** Espelha `Project` (backend-v2 database/entities/project.entity.ts). */
export interface ProjectSummary {
    id: string;
    spec: string;
    status: ProjectStatus;
    machine?: string;
    executionMode: ExecutionMode;
    costCapEnabled: boolean;
    costCapValue?: number;
    gitPushAllowed: boolean;
    architectPlan?: string;
    createdAt: string;
    updatedAt: string;
}

export interface ProjectStepSummary {
    id: string;
    role: ProjectStepRole;
    status: ProjectStepStatus;
    instruction?: string;
    report?: string;
    ok: boolean;
    tokensSpentEstimate?: number;
    startedAt?: string | null;
    finishedAt?: string | null;
}

export interface ProjectEventSummary {
    id: string;
    kind: string;
    note: string;
    createdAt: string;
}

export interface ProjectDetail {
    project: ProjectSummary;
    steps: ProjectStepSummary[];
    events: ProjectEventSummary[];
}

export interface CreateProjectInput {
    spec: string;
    machine?: string;
    costCapValue?: number;
    gitPushAllowed?: boolean;
}

export interface CreateProjectOutcome {
    projectId?: string;
    plan?: string;
    executionMode?: ExecutionMode;
    error?: string;
}

export interface OkOrError {
    ok: boolean;
    error?: string;
}

/** Consome `ProjectsController` (backend-v2, `src/dev-team/projects.controller.ts`) — ver docs/agent-team-architecture.md §4/§8. */
@Injectable({ providedIn: "root" })
export class ProjectsService {
    private readonly http = inject(HttpClient);

    list(): Promise<ProjectSummary[]> {
        return firstValueFrom(this.http.get<ProjectSummary[]>("/projects"));
    }

    get(id: string): Promise<ProjectDetail> {
        return firstValueFrom(this.http.get<ProjectDetail>(`/projects/${id}`));
    }

    create(input: CreateProjectInput): Promise<CreateProjectOutcome> {
        return firstValueFrom(this.http.post<CreateProjectOutcome>("/projects", input));
    }

    requestRevision(id: string, roles: ProjectStepRole[], note: string): Promise<OkOrError> {
        return firstValueFrom(this.http.post<OkOrError>(`/projects/${id}/revision`, { roles, note }));
    }

    resume(id: string): Promise<OkOrError> {
        return firstValueFrom(this.http.post<OkOrError>(`/projects/${id}/resume`, {}));
    }

    cancel(id: string, reason?: string): Promise<OkOrError> {
        return firstValueFrom(this.http.post<OkOrError>(`/projects/${id}/cancel`, { reason }));
    }

    listAutonomyPolicies(): Promise<Record<AutonomyDecision, AutonomyMode>> {
        return firstValueFrom(this.http.get<Record<AutonomyDecision, AutonomyMode>>("/projects/autonomy-policies"));
    }

    setAutonomyPolicy(decision: AutonomyDecision, mode: AutonomyMode): Promise<Record<AutonomyDecision, AutonomyMode>> {
        return firstValueFrom(this.http.patch<Record<AutonomyDecision, AutonomyMode>>(`/projects/autonomy-policies/${decision}`, { mode }));
    }
}
