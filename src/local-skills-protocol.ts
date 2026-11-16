export const LOCAL_SKILLS_CAPABILITY = "skills_v1";
export const LOCAL_SKILLS_PROTOCOL_VERSION = 1 as const;
export const MAX_LOCAL_SKILLS_COUNT = 100;
export const MAX_LOCAL_SKILL_ID_CHARS = 64;
export const MAX_LOCAL_SKILL_NAME_CHARS = 64;
export const MAX_LOCAL_SKILL_DESCRIPTION_BYTES = 1024;
export const MAX_LOCAL_SKILLS_CATALOG_BYTES = 128 * 1024;
export const MAX_LOCAL_SKILL_CONTENT_BYTES = 32 * 1024;
export const MAX_LOCAL_SKILLS_WIRE_BYTES = 160 * 1024;

const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION = /^sha256:[a-f0-9]{64}$/;
const ERROR_CODES = new Set(["invalid_request", "not_found", "disabled", "stale_revision", "payload_too_large", "timeout", "unavailable", "unsupported_operation"]);

export interface LocalSkillMetadata {
    skillId: string;
    name: string;
    description: string;
    revision: string;
    enabled: true;
}
export type LocalSkillsRequest = { operation: "list" } | { operation: "load"; skillId: string; revision: string };
export type LocalSkillsResult =
    | { operation: "list"; status: "ok"; skills: LocalSkillMetadata[] }
    | { operation: "load"; status: "ok"; skillId: string; revision: string; content: string }
    | { operation: "list" | "load"; status: "error"; code: string; message: string };

export interface LocalSkillsProvider {
    list(): Promise<LocalSkillMetadata[]>;
    load(skillId: string, revision: string): Promise<{ revision: string; content: string }>;
}

export type LocalSkillsValidation<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
    const actual = Object.keys(value).sort();
    const keys = expected.sort();
    return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function fail<T>(code: string, message: string): LocalSkillsValidation<T> {
    return { ok: false, code, message };
}

function byteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
}

function validSkillId(value: unknown): value is string {
    return typeof value === "string" && value.length <= MAX_LOCAL_SKILL_ID_CHARS && SKILL_ID.test(value);
}

function validRevision(value: unknown): value is string {
    return typeof value === "string" && REVISION.test(value);
}

export function validateLocalSkillsRequest(value: unknown): LocalSkillsValidation<LocalSkillsRequest> {
    if (!isRecord(value)) return fail("invalid_request", "Operação de skills inválida.");
    if (value.operation === "list" && exactKeys(value, ["operation"])) return { ok: true, value: { operation: "list" } };
    if (value.operation === "load" && exactKeys(value, ["operation", "skillId", "revision"]) && validSkillId(value.skillId) && validRevision(value.revision)) {
        return { ok: true, value: { operation: "load", skillId: value.skillId, revision: value.revision } };
    }
    return fail("invalid_request", "A operação deve ser list ou load com identificador e revisão válidos; caminhos não são aceitos.");
}

export async function handleLocalSkillsRequest(value: unknown, provider: LocalSkillsProvider): Promise<LocalSkillsResult> {
    const parsed = validateLocalSkillsRequest(value);
    if (!parsed.ok) return { operation: isRecord(value) && value.operation === "load" ? "load" : "list", status: "error", code: parsed.code, message: parsed.message };
    const { request } = { request: parsed.value };
    try {
        let result: LocalSkillsResult;
        if (request.operation === "list") {
            const skills = await withTimeout(provider.list(), 4_000);
            if (skills === TIMEOUT) return { operation: "list", status: "error", code: "timeout", message: "A operação de skills expirou no Client." };
            result = { operation: "list", status: "ok", skills };
        } else {
            const loaded = await withTimeout(provider.load(request.skillId, request.revision), 8_000);
            if (loaded === TIMEOUT) return { operation: "load", status: "error", code: "timeout", message: "A operação de skills expirou no Client." };
            if (loaded.revision !== request.revision) return { operation: "load", status: "error", code: "stale_revision", message: "A revisão local mudou; atualize o catálogo." };
            result = { operation: "load", status: "ok", skillId: request.skillId, revision: loaded.revision, content: loaded.content };
        }
        if (request.operation === "list" && (result as { skills: unknown[] }).skills.length > MAX_LOCAL_SKILLS_COUNT) {
            return { operation: "list", status: "error", code: "payload_too_large", message: "O catálogo excede os limites permitidos." };
        }
        const checked = validateLocalSkillsResult(result, request.operation, request.operation === "load" ? request : undefined);
        if (!checked.ok) return { operation: request.operation, status: "error", code: checked.code, message: checked.message };
        return result;
    } catch (error) {
        const code = error instanceof LocalSkillsProviderError ? error.code : "unavailable";
        const message = code === "not_found" ? "Skill local indisponível." : code === "disabled" ? "Skill local desabilitada." : code === "stale_revision" ? "A revisão local mudou; atualize o catálogo." : "Não foi possível atender à operação de skills.";
        return { operation: request.operation, status: "error", code, message };
    }
}

export async function handleLocalSkillsExec(requestId: unknown, payload: unknown, provider?: LocalSkillsProvider): Promise<{
    type: "exec-result";
    requestId: string;
    ok: boolean;
    result?: LocalSkillsResult;
    error?: string;
}> {
    if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
        return { type: "exec-result", requestId: "", ok: false, error: "invalid_request_id" };
    }
    if (!provider) return { type: "exec-result", requestId, ok: false, error: "skills_unsupported" };
    const result = await handleLocalSkillsRequest(payload, provider);
    const response = { type: "exec-result" as const, requestId, ok: true, result };
    if (byteLength(JSON.stringify(response)) <= MAX_LOCAL_SKILLS_WIRE_BYTES) return response;
    const operation = isRecord(payload) && payload.operation === "load" ? "load" : "list";
    return {
        type: "exec-result",
        requestId,
        ok: true,
        result: { operation, status: "error", code: "payload_too_large", message: "A resposta WebSocket excede o limite permitido." },
    };
}

const TIMEOUT = Symbol("local-skills-timeout");
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof TIMEOUT> {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([promise, new Promise<typeof TIMEOUT>((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), timeoutMs); })])
        .finally(() => { if (timer) clearTimeout(timer); });
}

export function validateLocalSkillsResult(
    value: unknown,
    operation: "list" | "load",
    expected?: { skillId: string; revision: string },
): LocalSkillsValidation<LocalSkillsResult> {
    if (!isRecord(value) || value.operation !== operation || typeof value.status !== "string") return fail("invalid_response", "Resposta do catálogo de skills inválida.");
    if (value.status === "error") {
        if (!exactKeys(value, ["operation", "status", "code", "message"]) || typeof value.code !== "string" || !ERROR_CODES.has(value.code) || typeof value.message !== "string" || value.message.length > 256) return fail("invalid_response", "Erro tipado de skills inválido.");
        return { ok: true, value: value as LocalSkillsResult };
    }
    if (value.status !== "ok") return fail("invalid_response", "Estado da resposta de skills desconhecido.");
    if (operation === "load") {
        if (!exactKeys(value, ["operation", "status", "skillId", "revision", "content"]) || !validSkillId(value.skillId) || !validRevision(value.revision) || typeof value.content !== "string") return fail("invalid_response", "Resposta de carregamento inválida.");
        if (expected && value.skillId !== expected.skillId) return fail("identity_mismatch", "A resposta não corresponde à skill solicitada.");
        if (expected && value.revision !== expected.revision) return fail("revision_mismatch", "A resposta não corresponde à revisão solicitada.");
        if (byteLength(value.content) > MAX_LOCAL_SKILL_CONTENT_BYTES) return fail("payload_too_large", "O conteúdo da skill excede o limite permitido.");
    } else {
        if (!exactKeys(value, ["operation", "status", "skills"]) || !Array.isArray(value.skills) || value.skills.length > MAX_LOCAL_SKILLS_COUNT) return fail("payload_too_large", "O catálogo excede os limites permitidos.");
        const ids = new Set<string>();
        let catalogBytes = byteLength('{"operation":"list","status":"ok","skills":[]}');
        for (const skill of value.skills) {
            if (!isRecord(skill) || !exactKeys(skill, ["skillId", "name", "description", "revision", "enabled"]) || !validSkillId(skill.skillId) || typeof skill.name !== "string" || skill.name.length === 0 || skill.name.length > MAX_LOCAL_SKILL_NAME_CHARS || typeof skill.description !== "string" || byteLength(skill.description) > MAX_LOCAL_SKILL_DESCRIPTION_BYTES || !validRevision(skill.revision) || skill.enabled !== true || ids.has(skill.skillId)) return fail("invalid_response", "Metadados de skill inválidos ou duplicados.");
            ids.add(skill.skillId);
            catalogBytes += byteLength(JSON.stringify(skill)) + (ids.size > 1 ? 1 : 0);
            if (catalogBytes > MAX_LOCAL_SKILLS_CATALOG_BYTES) return fail("payload_too_large", "O catálogo excede o limite de bytes permitido.");
        }
    }
    if (byteLength(JSON.stringify(value)) > MAX_LOCAL_SKILLS_WIRE_BYTES) return fail("payload_too_large", "A resposta WebSocket excede o limite permitido.");
    return { ok: true, value: value as LocalSkillsResult };
}

export class LocalSkillsProviderError extends Error {
    readonly code: "not_found" | "disabled" | "stale_revision" | "unavailable";

    constructor(code: "not_found" | "disabled" | "stale_revision" | "unavailable", message = code) {
        super(message);
        this.code = code;
    }
}
