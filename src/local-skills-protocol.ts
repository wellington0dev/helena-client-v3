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
const ERROR_CODES = new Set(["invalid_request", "invalid_source", "not_found", "disabled", "stale_revision", "payload_too_large", "timeout", "unavailable", "unsupported_operation", "conflict", "network", "incompatible_skill", "unsupported_files"]);

export interface LocalSkillMetadata {
    skillId: string;
    name: string;
    description: string;
    revision: string;
    enabled: boolean;
    source?: string;
}
export type LocalSkillsOperation = "list" | "load" | "inspect" | "create" | "edit" | "preview_file" | "install_file" | "preview_git" | "install_git" | "enable" | "disable" | "delete";
export type LocalSkillsRequest =
    | { operation: "list" }
    | { operation: "load" | "inspect"; skillId: string; revision: string }
    | { operation: "create"; skillId: string; description: string; instructions: string }
    | { operation: "edit"; skillId: string; revision: string; description: string; instructions: string }
    | { operation: "preview_file" | "install_file"; content: string }
    | { operation: "preview_git"; source: string; skillPath?: string }
    | { operation: "install_git"; source: string; skillPath: string; sourceRevision: string; allowUnsupportedFiles?: true }
    | { operation: "enable" | "disable"; skillId: string; revision: string }
    | { operation: "delete"; skillId: string; revision: string; confirmed: true };
export type LocalSkillsResult =
    | { operation: "list"; status: "ok"; skills: LocalSkillMetadata[] }
    | { operation: "load"; status: "ok"; skillId: string; revision: string; content: string }
    | { operation: Exclude<LocalSkillsOperation, "list" | "load">; status: "ok"; [key: string]: unknown }
    | { operation: LocalSkillsOperation; status: "error"; code: string; message: string };

export interface LocalSkillsProvider {
    list(): Promise<LocalSkillMetadata[]>;
    load(skillId: string, revision: string): Promise<{ revision: string; content: string }>;
}
export interface LocalSkillsManagementProvider extends LocalSkillsProvider {
    inspect?(skillId: string, revision: string): Promise<Record<string, unknown>>;
    create?(draft: { skillId: string; description: string; instructions: string }): Promise<Record<string, unknown>>;
    edit?(draft: { skillId: string; revision: string; description: string; instructions: string }): Promise<Record<string, unknown>>;
    previewMarkdown?(content: string): Record<string, unknown>;
    installMarkdown?(content: string, source: string): Promise<Record<string, unknown>>;
    previewGit?(source: string, skillPath?: string): Promise<Record<string, unknown>>;
    installGit?(source: string, skillPath: string, sourceRevision: string, allowUnsupportedFiles?: boolean): Promise<Record<string, unknown>>;
    setEnabled?(skillId: string, revision: string, enabled: boolean): Promise<Record<string, unknown>>;
    remove?(skillId: string, revision: string, confirmed: boolean): Promise<Record<string, unknown>>;
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

function validGitSource(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 2_048 || /%(?:2f|5c)/i.test(value)) return false;
    try {
        const url = new URL(value);
        const host = url.hostname.toLowerCase();
        if (url.protocol !== "https:" || !["github.com", "raw.githubusercontent.com"].includes(host)
            || url.username || url.password || url.port || url.search || url.hash) return false;
        const rawPath = value.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? "";
        const parts = rawPath.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
        if (parts.some((part) => part === "." || part === ".." || /[\\/\u0000-\u001f\u007f]/.test(part))) return false;
        if (host === "raw.githubusercontent.com") return parts.length >= 5 && parts.at(-1) === "SKILL.md";
        if (parts.length < 2) return false;
        const route = parts[2];
        return parts.length === 2 || (route === "tree" && parts.length >= 4)
            || (route === "blob" && parts.length >= 5 && parts.at(-1) === "SKILL.md");
    } catch {
        return false;
    }
}

function validSkillPath(value: unknown): value is string {
    return typeof value === "string" && value.length <= 512
        && (value === "" || value.split("/").every((part) => part.length > 0 && part.length <= 128 && part !== "." && part !== ".." && !/[\\\u0000-\u001f\u007f]/.test(part)));
}

export function validateLocalSkillsRequest(value: unknown): LocalSkillsValidation<LocalSkillsRequest> {
    if (!isRecord(value)) return fail("invalid_request", "Operação de skills inválida.");
    if (value.operation === "list" && exactKeys(value, ["operation"])) return { ok: true, value: { operation: "list" } };
    const operation = value.operation;
    if ((operation === "load" || operation === "inspect" || operation === "enable" || operation === "disable")
        && exactKeys(value, ["operation", "skillId", "revision"]) && validSkillId(value.skillId) && validRevision(value.revision)) {
        return { ok: true, value: { operation, skillId: value.skillId, revision: value.revision } };
    }
    if ((operation === "create" || operation === "edit")
        && exactKeys(value, operation === "create"
            ? ["operation", "skillId", "description", "instructions"]
            : ["operation", "skillId", "revision", "description", "instructions"])
        && validSkillId(value.skillId) && (operation === "create" || validRevision(value.revision))
        && typeof value.description === "string" && byteLength(value.description) <= MAX_LOCAL_SKILL_DESCRIPTION_BYTES
        && typeof value.instructions === "string" && byteLength(value.instructions) <= MAX_LOCAL_SKILL_CONTENT_BYTES) {
        return { ok: true, value: value as LocalSkillsRequest };
    }
    if ((operation === "preview_file" || operation === "install_file") && exactKeys(value, ["operation", "content"])
        && typeof value.content === "string" && byteLength(value.content) <= MAX_LOCAL_SKILL_CONTENT_BYTES) {
        return { ok: true, value: value as LocalSkillsRequest };
    }
    if (operation === "preview_git"
        && (exactKeys(value, ["operation", "source"]) || exactKeys(value, ["operation", "source", "skillPath"]))
        && validGitSource(value.source) && (value.skillPath === undefined || validSkillPath(value.skillPath))) {
        return { ok: true, value: value as LocalSkillsRequest };
    }
    if (operation === "install_git" && (exactKeys(value, ["operation", "source", "skillPath", "sourceRevision"])
        || exactKeys(value, ["operation", "source", "skillPath", "sourceRevision", "allowUnsupportedFiles"]))
        && validGitSource(value.source) && validSkillPath(value.skillPath) && validRevision(value.sourceRevision)
        && (value.allowUnsupportedFiles === undefined || value.allowUnsupportedFiles === true)) {
        return { ok: true, value: value as LocalSkillsRequest };
    }
    if (operation === "delete" && exactKeys(value, ["operation", "skillId", "revision", "confirmed"])
        && validSkillId(value.skillId) && validRevision(value.revision) && value.confirmed === true) {
        return { ok: true, value: value as LocalSkillsRequest };
    }
    return fail("invalid_request", "Operação, identificador, revisão ou conteúdo de skill inválido.");
}

export async function handleLocalSkillsRequest(value: unknown, provider: LocalSkillsManagementProvider): Promise<LocalSkillsResult> {
    const parsed = validateLocalSkillsRequest(value);
    if (!parsed.ok) return { operation: isRecord(value) && typeof value.operation === "string" && LOCAL_OPERATIONS.has(value.operation as LocalSkillsOperation) ? value.operation as LocalSkillsOperation : "list", status: "error", code: parsed.code, message: parsed.message };
    const request = parsed.value;
    const operation = request.operation;
    try {
        let pending: Promise<Record<string, unknown> | LocalSkillMetadata[]> | Record<string, unknown> | LocalSkillMetadata[];
        switch (operation) {
            case "list":
                pending = provider.list();
                break;
            case "load": {
                const loaded = await withTimeout(provider.load(request.skillId, request.revision), 8_000);
                if (loaded === TIMEOUT) return timeoutResult(operation);
                if (loaded.revision !== request.revision) throw new LocalSkillsProviderError("stale_revision");
                if (byteLength(loaded.content) > MAX_LOCAL_SKILL_CONTENT_BYTES) return errorResult(operation, "payload_too_large", "O conteúdo da skill excede o limite permitido.");
                return wrapResult(operation, { skillId: request.skillId, revision: loaded.revision, content: loaded.content }, MAX_LOCAL_SKILL_CONTENT_BYTES);
            }
            case "inspect":
                if (!provider.inspect) throw new LocalSkillsProviderError("unavailable");
                pending = provider.inspect(request.skillId, request.revision);
                break;
            case "create":
                if (!provider.create) throw new LocalSkillsProviderError("unavailable");
                pending = provider.create(request);
                break;
            case "edit":
                if (!provider.edit) throw new LocalSkillsProviderError("unavailable");
                pending = provider.edit(request);
                break;
            case "preview_file":
                if (!provider.previewMarkdown) throw new LocalSkillsProviderError("unavailable");
                pending = provider.previewMarkdown(request.content);
                break;
            case "install_file":
                if (!provider.installMarkdown) throw new LocalSkillsProviderError("unavailable");
                pending = provider.installMarkdown(request.content, "local-file");
                break;
            case "preview_git":
                if (!provider.previewGit) throw new LocalSkillsProviderError("unavailable");
                pending = provider.previewGit(request.source, request.skillPath);
                break;
            case "install_git":
                if (!provider.installGit) throw new LocalSkillsProviderError("unavailable");
                pending = provider.installGit(request.source, request.skillPath, request.sourceRevision, request.allowUnsupportedFiles === true);
                break;
            case "enable":
            case "disable":
                if (!provider.setEnabled) throw new LocalSkillsProviderError("unavailable");
                pending = provider.setEnabled(request.skillId, request.revision, operation === "enable");
                break;
            case "delete":
                if (!provider.remove) throw new LocalSkillsProviderError("unavailable");
                pending = provider.remove(request.skillId, request.revision, request.confirmed);
                break;
        }
        const result = await withTimeout(Promise.resolve(pending), operation === "list" ? 4_000 : operation === "preview_git" || operation === "install_git" ? 40_000 : 12_000);
        if (result === TIMEOUT) return timeoutResult(operation);
        if (operation === "list") {
            const skills = result as LocalSkillMetadata[];
            if (skills.length > MAX_LOCAL_SKILLS_COUNT) return errorResult(operation, "payload_too_large", "O catálogo excede os limites permitidos.");
            return wrapResult(operation, { skills }, MAX_LOCAL_SKILLS_CATALOG_BYTES);
        }
        return wrapResult(operation, result as Record<string, unknown>, operation === "preview_git" ? MAX_LOCAL_SKILLS_CATALOG_BYTES : MAX_LOCAL_SKILL_CONTENT_BYTES);
    } catch (error) {
        const code = error instanceof LocalSkillsProviderError ? error.code : error instanceof Error && /já existe/i.test(error.message) ? "conflict" : "unavailable";
        const message = error instanceof LocalSkillsProviderError
            ? error.message === error.code ? safeErrorMessage(code) : error.message
            : code === "conflict" ? "Já existe uma skill com esse identificador."
                : "Não foi possível concluir a operação de skills.";
        return errorResult(operation, code, message);
    }
}

const LOCAL_OPERATIONS = new Set<LocalSkillsOperation>(["list", "load", "inspect", "create", "edit", "preview_file", "install_file", "preview_git", "install_git", "enable", "disable", "delete"]);
function errorResult(operation: LocalSkillsOperation, code: string, message: string): LocalSkillsResult {
    return { operation, status: "error", code, message: message.slice(0, 256) };
}
function timeoutResult(operation: LocalSkillsOperation): LocalSkillsResult {
    return errorResult(operation, "timeout", "A operação de skills expirou no Client.");
}
function safeErrorMessage(code: string): string {
    if (code === "not_found") return "Skill local indisponível.";
    if (code === "disabled") return "Skill local desabilitada.";
    if (code === "stale_revision") return "A revisão local mudou; atualize o catálogo.";
    if (code === "payload_too_large") return "O conteúdo excede o limite permitido.";
    return "Não foi possível concluir a operação de skills.";
}
function wrapResult(operation: LocalSkillsOperation, result: Record<string, unknown>, maxBytes: number): LocalSkillsResult {
    const response = { operation, status: "ok" as const, ...result };
    if (byteLength(JSON.stringify(response)) <= Math.max(maxBytes, MAX_LOCAL_SKILL_CONTENT_BYTES) + 2_048) return response as LocalSkillsResult;
    return errorResult(operation, "payload_too_large", "A resposta excede o limite permitido.");
}

export async function handleLocalSkillsExec(requestId: unknown, payload: unknown, provider?: LocalSkillsManagementProvider): Promise<{
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
    const operation = isRecord(payload) && typeof payload.operation === "string" && LOCAL_OPERATIONS.has(payload.operation as LocalSkillsOperation) ? payload.operation as LocalSkillsOperation : "list";
    return {
        type: "exec-result",
        requestId,
        ok: true,
        result: errorResult(operation, "payload_too_large", "A resposta WebSocket excede o limite permitido."),
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
    operation: LocalSkillsOperation,
    expected?: { skillId: string; revision: string },
): LocalSkillsValidation<LocalSkillsResult> {
    if (!isRecord(value) || value.operation !== operation || typeof value.status !== "string") return fail("invalid_response", "Resposta do catálogo de skills inválida.");
    if (value.status === "error") {
        if (!exactKeys(value, ["operation", "status", "code", "message"]) || typeof value.code !== "string" || !ERROR_CODES.has(value.code) || typeof value.message !== "string" || value.message.length > 256) return fail("invalid_response", "Erro tipado de skills inválido.");
        return { ok: true, value: value as LocalSkillsResult };
    }
    if (value.status !== "ok") return fail("invalid_response", "Estado da resposta de skills desconhecido.");
    if (operation === "preview_git") {
        if (value.kind === "catalog") {
            if (!exactKeys(value, ["operation", "status", "kind", "source", "ref", "commit", "skills"])
                || typeof value.source !== "string" || typeof value.ref !== "string" || typeof value.commit !== "string"
                || !Array.isArray(value.skills) || value.skills.length > 250) return fail("invalid_response", "Catálogo remoto inválido.");
            for (const skill of value.skills) {
                if (!isRecord(skill) || !["skillPath", "skillId", "description", "revision", "compatible", "unsupportedFiles"].every((key) => key in skill)
                    || Object.keys(skill).some((key) => !["skillPath", "skillId", "description", "revision", "compatible", "incompatibility", "unsupportedFiles"].includes(key))
                    || !validSkillPath(skill.skillPath) || !validSkillId(skill.skillId) || typeof skill.description !== "string"
                    || byteLength(skill.description) > MAX_LOCAL_SKILL_DESCRIPTION_BYTES || !validRevision(skill.revision) || typeof skill.compatible !== "boolean"
                    || (skill.incompatibility !== undefined && (typeof skill.incompatibility !== "string" || skill.incompatibility.length > 256))
                    || !Array.isArray(skill.unsupportedFiles) || skill.unsupportedFiles.length > 20
                    || skill.unsupportedFiles.some((file) => typeof file !== "string" || file.length > 256)) return fail("invalid_response", "Skill remota inválida.");
            }
        } else if (value.kind === "preview") {
            if (!exactKeys(value, ["operation", "status", "kind", "skillPath", "skillId", "description", "instructions", "source", "sourceRevision", "unsupportedFiles"])
                || !validSkillPath(value.skillPath) || !validSkillId(value.skillId) || typeof value.description !== "string"
                || byteLength(value.description) > MAX_LOCAL_SKILL_DESCRIPTION_BYTES || typeof value.instructions !== "string"
                || byteLength(value.instructions) > MAX_LOCAL_SKILL_CONTENT_BYTES || typeof value.source !== "string"
                || !validRevision(value.sourceRevision) || !Array.isArray(value.unsupportedFiles) || value.unsupportedFiles.length > 20
                || value.unsupportedFiles.some((file) => typeof file !== "string" || file.length > 256)) return fail("invalid_response", "Prévia remota inválida.");
        } else return fail("invalid_response", "Tipo de prévia remota desconhecido.");
    }
    if (operation === "load") {
        if (!exactKeys(value, ["operation", "status", "skillId", "revision", "content"]) || !validSkillId(value.skillId) || !validRevision(value.revision) || typeof value.content !== "string") return fail("invalid_response", "Resposta de carregamento inválida.");
        if (expected && value.skillId !== expected.skillId) return fail("identity_mismatch", "A resposta não corresponde à skill solicitada.");
        if (expected && value.revision !== expected.revision) return fail("revision_mismatch", "A resposta não corresponde à revisão solicitada.");
        if (byteLength(value.content) > MAX_LOCAL_SKILL_CONTENT_BYTES) return fail("payload_too_large", "O conteúdo da skill excede o limite permitido.");
    } else if (operation === "list") {
        if (!exactKeys(value, ["operation", "status", "skills"]) || !Array.isArray(value.skills) || value.skills.length > MAX_LOCAL_SKILLS_COUNT) return fail("payload_too_large", "O catálogo excede os limites permitidos.");
        const ids = new Set<string>();
        let catalogBytes = byteLength('{"operation":"list","status":"ok","skills":[]}');
        for (const skill of value.skills) {
            if (!isRecord(skill) || !["skillId", "name", "description", "revision", "enabled"].every((key) => key in skill) || Object.keys(skill).some((key) => !["skillId", "name", "description", "revision", "enabled", "source"].includes(key)) || !validSkillId(skill.skillId) || typeof skill.name !== "string" || skill.name.length === 0 || skill.name.length > MAX_LOCAL_SKILL_NAME_CHARS || typeof skill.description !== "string" || byteLength(skill.description) > MAX_LOCAL_SKILL_DESCRIPTION_BYTES || !validRevision(skill.revision) || typeof skill.enabled !== "boolean" || (skill.source !== undefined && (typeof skill.source !== "string" || skill.source.length > 256)) || ids.has(skill.skillId)) return fail("invalid_response", "Metadados de skill inválidos ou duplicados.");
            ids.add(skill.skillId);
            catalogBytes += byteLength(JSON.stringify(skill)) + (ids.size > 1 ? 1 : 0);
            if (catalogBytes > MAX_LOCAL_SKILLS_CATALOG_BYTES) return fail("payload_too_large", "O catálogo excede o limite de bytes permitido.");
        }
    }
    if (byteLength(JSON.stringify(value)) > MAX_LOCAL_SKILLS_WIRE_BYTES) return fail("payload_too_large", "A resposta WebSocket excede o limite permitido.");
    return { ok: true, value: value as LocalSkillsResult };
}

export class LocalSkillsProviderError extends Error {
    readonly code: "invalid_source" | "not_found" | "disabled" | "stale_revision" | "payload_too_large" | "unavailable" | "network" | "incompatible_skill" | "unsupported_files";

    constructor(code: "invalid_source" | "not_found" | "disabled" | "stale_revision" | "payload_too_large" | "unavailable" | "network" | "incompatible_skill" | "unsupported_files", message: string = code) {
        super(message);
        this.code = code;
    }
}
