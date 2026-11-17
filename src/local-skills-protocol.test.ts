import assert from "node:assert/strict";
import test from "node:test";
import { handleLocalSkillsExec, handleLocalSkillsRequest, LocalSkillsProviderError, validateLocalSkillsRequest, validateLocalSkillsResult } from "./local-skills-protocol.ts";

const revision = `sha256:${"a".repeat(64)}`;

test("accepts versioned read and management operations with validated identifiers", () => {
    assert.equal(validateLocalSkillsRequest({ operation: "list" }).ok, true);
    assert.equal(validateLocalSkillsRequest({ operation: "load", skillId: "proofreading", revision }).ok, true);
    assert.equal(validateLocalSkillsRequest({ operation: "create", skillId: "proofreading", description: "Correção", instructions: "Revise." }).ok, true);
    assert.equal(validateLocalSkillsRequest({ operation: "edit", skillId: "proofreading", revision, description: "Correção", instructions: "Revise." }).ok, true);
    assert.equal(validateLocalSkillsRequest({ operation: "delete", skillId: "proofreading", revision, confirmed: true }).ok, true);
    assert.equal(validateLocalSkillsRequest({ operation: "preview_git", source: "https://github.com/owner/repo" }).ok, true);
    assert.equal(validateLocalSkillsRequest({ operation: "preview_git", source: "https://github.com/owner/repo/tree/feature/design/skills/review" }).ok, true);
    assert.equal(validateLocalSkillsRequest({ operation: "preview_git", source: "https://raw.githubusercontent.com/owner/repo/main/skills/review/SKILL.md" }).ok, true);
    assert.equal(validateLocalSkillsRequest({ operation: "preview_git", source: "https://github.com/owner/repo/tree/main/%2e%2e/private" }).ok, false);
    assert.equal(validateLocalSkillsRequest({ operation: "preview_git", source: "https://github.com.attacker.test/owner/repo" }).ok, false);
    assert.equal(validateLocalSkillsRequest({ operation: "install_git", source: "https://github.com/owner/repo", skillPath: "../outside", sourceRevision: revision }).ok, false);
    assert.equal(validateLocalSkillsRequest({ operation: "install_git", source: "https://github.com/owner/repo", skillPath: "skills/review", sourceRevision: revision, allowUnsupportedFiles: false }).ok, false);
    assert.equal(validateLocalSkillsRequest({ operation: "delete", skillId: "proofreading", revision }).ok, false);
    assert.equal(validateLocalSkillsRequest({ operation: "load", skillId: "../etc/passwd", revision }).ok, false);
    assert.equal(validateLocalSkillsRequest({ operation: "list", path: "/tmp" }).ok, false);
});

test("validates typed GitHub catalogs/previews and rejects malformed protocol responses", () => {
    const candidate = { skillPath: "skills/design", skillId: "system-design", description: "Design systems", revision, compatible: true, unsupportedFiles: [] };
    assert.equal(validateLocalSkillsResult({
        operation: "preview_git", status: "ok", kind: "catalog", source: "https://github.com/acme/skills/tree/main",
        ref: "main", commit: "b".repeat(40), skills: [candidate],
    }, "preview_git").ok, true);
    assert.equal(validateLocalSkillsResult({
        operation: "preview_git", status: "ok", kind: "preview", skillPath: candidate.skillPath, skillId: candidate.skillId,
        description: candidate.description, instructions: "Design.", source: "https://github.com/acme/skills/tree/main/skills/design",
        sourceRevision: revision, unsupportedFiles: [],
    }, "preview_git").ok, true);
    assert.equal(validateLocalSkillsResult({
        operation: "preview_git", status: "ok", kind: "preview", skillPath: "../secret", skillId: candidate.skillId,
        description: candidate.description, instructions: "Design.", source: "https://github.com/acme/skills",
        sourceRevision: revision, unsupportedFiles: [],
    }, "preview_git").ok, false);
});

test("list returns metadata only and load passes exact identity/revision to local provider", async () => {
    const calls: unknown[] = [];
    const provider = {
        async list() { calls.push("list"); return [{ skillId: "proofreading", name: "proofreading", description: "Correção", revision, enabled: true as const }]; },
        async load(skillId: string, expectedRevision: string) { calls.push({ skillId, expectedRevision }); return { revision: expectedRevision, content: "instruções" }; },
    };
    assert.deepEqual(await handleLocalSkillsRequest({ operation: "list" }, provider), {
        operation: "list", status: "ok", skills: [{ skillId: "proofreading", name: "proofreading", description: "Correção", revision, enabled: true }],
    });
    assert.deepEqual(await handleLocalSkillsRequest({ operation: "load", skillId: "proofreading", revision }, provider), {
        operation: "load", status: "ok", skillId: "proofreading", revision, content: "instruções",
    });
    assert.deepEqual(calls, ["list", { skillId: "proofreading", expectedRevision: revision }]);
});

test("returns typed errors and refuses oversized provider output without truncating", async () => {
    const provider = {
        async list() { return []; },
        async load(skillId: string, expectedRevision: string) {
            if (skillId === "unknown") throw new LocalSkillsProviderError("not_found");
            return { revision: expectedRevision, content: "x".repeat(32 * 1024 + 1) };
        },
    };
    assert.deepEqual(await handleLocalSkillsRequest({ operation: "load", skillId: "proofreading", revision }, provider), {
        operation: "load", status: "error", code: "payload_too_large", message: "O conteúdo da skill excede o limite permitido.",
    });
    assert.deepEqual(await handleLocalSkillsRequest({ operation: "load", skillId: "unknown", revision }, provider), {
        operation: "load", status: "error", code: "not_found", message: "Skill local indisponível.",
    });
    const changedRevision = { list: provider.list, async load() { return { revision: `sha256:${"b".repeat(64)}`, content: "conteúdo novo" }; } };
    assert.deepEqual(await handleLocalSkillsRequest({ operation: "load", skillId: "proofreading", revision }, changedRevision), {
        operation: "load", status: "error", code: "stale_revision", message: "A revisão local mudou; atualize o catálogo.",
    });
});

test("rejects oversized catalog without truncating it", async () => {
    const provider = {
        async list() { return Array.from({ length: 101 }, (_, index) => ({ skillId: `skill-${index}`, name: `skill-${index}`, description: "x", revision, enabled: true as const })); },
        async load(_skillId: string, expectedRevision: string) { return { revision: expectedRevision, content: "" }; },
    };
    assert.deepEqual(await handleLocalSkillsRequest({ operation: "list" }, provider), {
        operation: "list", status: "error", code: "payload_too_large", message: "O catálogo excede os limites permitidos.",
    });
});

test("exec response preserves request correlation and does not expose the capability without an injected provider", async () => {
    const requestId = "123e4567-e89b-12d3-a456-426614174000";
    assert.deepEqual(await handleLocalSkillsExec(requestId, { operation: "list" }), {
        type: "exec-result", requestId, ok: false, error: "skills_unsupported",
    });
    const provider = { async list() { return []; }, async load(_skillId: string, expectedRevision: string) { return { revision: expectedRevision, content: "" }; } };
    assert.deepEqual(await handleLocalSkillsExec(requestId, { operation: "list" }, provider), {
        type: "exec-result", requestId, ok: true, result: { operation: "list", status: "ok", skills: [] },
    });
});

test("list timeout returns a typed error and ignores a provider result that arrives afterward", async () => {
    let finishLate!: (skills: []) => void;
    const provider = {
        list() { return new Promise<[]>(resolve => { finishLate = resolve; }); },
        async load(_skillId: string, expectedRevision: string) { return { revision: expectedRevision, content: "" }; },
    };
    const pending = handleLocalSkillsRequest({ operation: "list" }, provider);
    const result = await pending;
    assert.deepEqual(result, {
        operation: "list", status: "error", code: "timeout", message: "A operação de skills expirou no Client.",
    });
    finishLate([]);
    assert.equal(result.status, "error");
});
