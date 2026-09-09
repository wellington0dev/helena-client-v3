import { HttpClient } from "@angular/common/http";
import { Injectable, inject } from "@angular/core";
import { firstValueFrom } from "rxjs";
import type { ProjectStepRole } from "./projects.service";

export type AgentRole = ProjectStepRole;

export const DEFAULT_AGENT_NAMES: Record<AgentRole, string> = {
    architect: "Ada",
    designer: "Vera",
    frontend: "Theo",
    backend: "Bento",
    dba: "Íris",
    qa: "Quinn",
};

/** Consome `AgentPersonasController` (backend-v2, `src/dev-team/agent-personas.controller.ts`) — nome exibido de cada agente da equipe de dev, por dono. */
@Injectable({ providedIn: "root" })
export class AgentPersonasService {
    private readonly http = inject(HttpClient);

    listAll(): Promise<Record<AgentRole, string>> {
        return firstValueFrom(this.http.get<Record<AgentRole, string>>("/agent-personas"));
    }

    setName(role: AgentRole, name: string): Promise<Record<AgentRole, string>> {
        return firstValueFrom(this.http.patch<Record<AgentRole, string>>(`/agent-personas/${role}`, { name }));
    }

    reset(role: AgentRole): Promise<Record<AgentRole, string>> {
        return firstValueFrom(this.http.delete<Record<AgentRole, string>>(`/agent-personas/${role}`));
    }
}
