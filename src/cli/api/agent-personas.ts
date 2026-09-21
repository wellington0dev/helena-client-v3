import { authed } from "./http.ts";

/** 7 papéis "clássicos" — papéis dinâmicos (inventados em runtime pela Arquiteta) também existem e não têm nome padrão (fallback: capitalizar o role). */
export const AGENT_ROLES = ["architect", "designer", "frontend", "backend", "dba", "security", "qa"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const DEFAULT_AGENT_NAMES: Record<AgentRole, string> = {
    architect: "Ada",
    designer: "Vera",
    frontend: "Theo",
    backend: "Bento",
    dba: "Íris",
    security: "Nyx",
    qa: "Quinn",
};

export function listAgentPersonas(baseUrl: string, token: string): Promise<Record<string, string>> {
    return authed(baseUrl, token, "GET", "/agent-personas");
}

export function setAgentPersonaName(baseUrl: string, token: string, role: string, name: string): Promise<Record<string, string>> {
    return authed(baseUrl, token, "PATCH", `/agent-personas/${encodeURIComponent(role)}`, { name });
}

export function resetAgentPersona(baseUrl: string, token: string, role: string): Promise<Record<string, string>> {
    return authed(baseUrl, token, "DELETE", `/agent-personas/${encodeURIComponent(role)}`);
}
