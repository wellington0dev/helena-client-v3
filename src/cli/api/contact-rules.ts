import { authed } from "./http.ts";

/** Espelha backend-v2 src/database/entities/contact-rule.entity.ts — regras de atendimento nos canais (2026-09-24). */
export type RuleScopeType = "contact" | "channel" | "group";
export type DisclosurePreset = "cpf" | "cnpj" | "cartao" | "email" | "telefone" | "senha" | "pix";

export interface FileGrant {
    machine: string;
    read?: { dirs: string[]; extensions: string[] };
    write?: { dirs: string[]; extensions: string[]; maxBytes?: number };
    deniedDirs: string[];
}

export interface RuleCapabilities {
    mcp?: { connectionId: string; tools: string[] }[];
    files?: FileGrant[];
    calendar?: { create: boolean; checkAvailability: boolean; onlyIfFree: boolean; maxPerDay: number };
    notes?: { create: boolean };
}

export interface RuleDisclosure {
    presets: DisclosurePreset[];
    terms: string[];
    templates: string[];
}

export interface ContactRule {
    id: string;
    name: string;
    enabled: boolean;
    scopeType: RuleScopeType;
    scopeChannel?: string | null;
    scopeContactId?: string | null;
    scopeGroupId?: string | null;
    taskDescription?: string | null;
    conditionText?: string | null;
    forbiddenText?: string | null;
    capabilities?: RuleCapabilities | null;
    disclosure?: RuleDisclosure | null;
    notifyOwner: boolean;
}

export type ContactRuleInput = Omit<ContactRule, "id">;

export interface AuditEntry {
    id: string;
    createdAt: string;
    channel: string;
    contactId?: string | null;
    groupId?: string | null;
    senderName?: string | null;
    kind: "tool" | "denied" | "output_blocked" | "tool_output_redacted";
    toolName?: string | null;
    argsSummary?: string | null;
    outcome: "ok" | "error" | "denied";
    reason?: string | null;
}

export function listContactRules(baseUrl: string, token: string): Promise<ContactRule[]> {
    return authed(baseUrl, token, "GET", "/contact-rules");
}

export function createContactRule(baseUrl: string, token: string, input: ContactRuleInput): Promise<ContactRule> {
    return authed(baseUrl, token, "POST", "/contact-rules", input);
}

export function updateContactRule(baseUrl: string, token: string, id: string, patch: Partial<ContactRuleInput>): Promise<ContactRule> {
    return authed(baseUrl, token, "PATCH", `/contact-rules/${id}`, patch);
}

export function deleteContactRule(baseUrl: string, token: string, id: string): Promise<{ deleted: true }> {
    return authed(baseUrl, token, "DELETE", `/contact-rules/${id}`);
}

export function listRuleAudit(baseUrl: string, token: string, limit = 50): Promise<AuditEntry[]> {
    return authed(baseUrl, token, "GET", `/contact-rules/audit?limit=${limit}`);
}

export function testDisclosureFilter(baseUrl: string, token: string, disclosure: RuleDisclosure, text: string): Promise<{ matched: string[]; redacted: string }> {
    return authed(baseUrl, token, "POST", "/contact-rules/test-filter", { disclosure, text });
}
