import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { createHash } from "node:crypto";
import { handleLocalSkillsExec, handleLocalSkillsRequest, LocalSkillsProviderError } from "./local-skills-protocol.ts";
import { LocalSkillsCatalog } from "./local-skills.ts";
import { LocalSkillsManager } from "./local-skills-management.ts";

const roots: string[] = [];
const CONTENT = [
    "---",
    "name: proofreading",
    "description: Corrige o texto sem mudar o sentido.",
    "---",
    "",
    "# Instruções privadas",
    "",
    "Preserve o tom da pessoa.",
].join("\n");
const BODY = "# Instruções privadas\n\nPreserve o tom da pessoa.";

function fixtureRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "helena-local-skills-"));
    roots.push(root);
    return root;
}

function writeSkill(root: string, id: string, content = CONTENT.replaceAll("proofreading", id)): string {
    const directory = path.join(root, id);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "SKILL.md");
    fs.writeFileSync(file, content);
    return file;
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test("missing root is read-only and returns an empty catalog", async () => {
    const parent = fixtureRoot();
    const missing = path.join(parent, "does-not-exist", "skills");
    assert.deepEqual(await new LocalSkillsCatalog(missing).list(), []);
    assert.equal(fs.existsSync(missing), false);
});

test("lists immediate valid skills deterministically with metadata and byte revisions only", async () => {
    const root = fixtureRoot();
    writeSkill(root, "zeta-writing", CONTENT.replaceAll("proofreading", "zeta-writing"));
    writeSkill(root, "academic-writing", CONTENT.replaceAll("proofreading", "academic-writing"));
    fs.mkdirSync(path.join(root, "nested", "ignored"), { recursive: true });

    const skills = await new LocalSkillsCatalog(root).list();
    assert.deepEqual(skills.map(({ skillId }) => skillId), ["academic-writing", "zeta-writing"]);
    assert.equal(skills[0]?.name, "academic-writing");
    assert.equal(skills[0]?.enabled, true);
    assert.match(skills[0]?.revision ?? "", /^sha256:[a-f0-9]{64}$/);
    assert.equal("content" in (skills[0] ?? {}), false);
    assert.equal("path" in (skills[0] ?? {}), false);
});

test("loads only the validated Markdown body and verifies the exact listed revision", async () => {
    const root = fixtureRoot();
    const file = writeSkill(root, "proofreading");
    const raw = fs.readFileSync(file);
    const revision = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    const catalog = new LocalSkillsCatalog(root);

    const loaded = await catalog.load("proofreading", revision);
    assert.deepEqual(loaded, { revision, content: BODY });

    const requestId = "123e4567-e89b-12d3-a456-426614174000";
    assert.deepEqual(await handleLocalSkillsExec(requestId, { operation: "load", skillId: "proofreading", revision }, catalog), {
        type: "exec-result",
        requestId,
        ok: true,
        result: { operation: "load", status: "ok", skillId: "proofreading", revision, content: BODY },
    });
});

test("protocol list exposes metadata only and returns an empty catalog when no skills exist", async () => {
    const root = fixtureRoot();
    writeSkill(root, "proofreading");
    const catalog = new LocalSkillsCatalog(root);
    const result = await handleLocalSkillsRequest({ operation: "list" }, catalog);
    assert.equal(result.operation, "list");
    assert.equal(result.status, "ok");
    if (result.status !== "ok" || result.operation !== "list") assert.fail("expected a successful list");
    assert.equal(result.skills.length, 1);
    assert.equal("content" in result.skills[0]!, false);
    assert.deepEqual(await new LocalSkillsCatalog(path.join(root, "empty")).list(), []);
});

test("changed, removed, invalid, and traversal loads fail closed", async () => {
    const root = fixtureRoot();
    const file = writeSkill(root, "proofreading");
    const catalog = new LocalSkillsCatalog(root);
    const [listed] = await catalog.list();
    assert.ok(listed);

    fs.writeFileSync(file, CONTENT.replace("Preserve o tom", "Altere o tom"));
    await assert.rejects(catalog.load("proofreading", listed.revision), (error: unknown) =>
        error instanceof LocalSkillsProviderError && error.code === "stale_revision");
    await assert.rejects(catalog.load("../outside", listed.revision), (error: unknown) =>
        error instanceof LocalSkillsProviderError && error.code === "not_found");

    fs.rmSync(file);
    await assert.rejects(catalog.load("proofreading", listed.revision), (error: unknown) =>
        error instanceof LocalSkillsProviderError && error.code === "not_found");
});

test("rejects an atomic SKILL.md replacement between list and load", async () => {
    const root = fixtureRoot();
    const file = writeSkill(root, "proofreading");
    const catalog = new LocalSkillsCatalog(root);
    const [listed] = await catalog.list();
    assert.ok(listed);
    const replacement = `${file}.replacement`;
    fs.writeFileSync(replacement, CONTENT.replace("Preserve o tom", "Mude o tom"));
    fs.renameSync(replacement, file);

    await assert.rejects(catalog.load("proofreading", listed.revision), (error: unknown) =>
        error instanceof LocalSkillsProviderError && error.code === "stale_revision");
});

test("invalid entries do not prevent valid entries and duplicates/malformed frontmatter are rejected", async () => {
    const root = fixtureRoot();
    writeSkill(root, "proofreading");
    writeSkill(root, "bad-frontmatter", "# no YAML frontmatter");
    writeSkill(root, "empty-body", "---\nname: empty-body\ndescription: Teste.\n---\n \n");
    writeSkill(root, "wrong-name", CONTENT.replaceAll("proofreading", "other-name"));
    writeSkill(root, "bad-description", "---\nname: bad-description\ndescription: \n---\nTexto.");

    const skills = await new LocalSkillsCatalog(root).list();
    assert.deepEqual(skills.map(({ skillId }) => skillId), ["proofreading"]);
});

test("rejects oversized, non-regular, and invalid UTF-8 SKILL.md files", async () => {
    const root = fixtureRoot();
    writeSkill(root, "proofreading");
    const oversized = writeSkill(root, "oversized");
    fs.writeFileSync(oversized, `---\nname: oversized\ndescription: Grande.\n---\n${"x".repeat(32 * 1024)}`);
    const nonRegular = path.join(root, "non-regular");
    fs.mkdirSync(nonRegular);
    fs.mkdirSync(path.join(nonRegular, "SKILL.md"));
    const invalidUtf8 = writeSkill(root, "invalid-utf8");
    fs.writeFileSync(invalidUtf8, Buffer.from([0xff, 0xfe, 0xfd]));

    assert.deepEqual((await new LocalSkillsCatalog(root).list()).map(({ skillId }) => skillId), ["proofreading"]);
});

test("rejects symlinked roots and all symlink entries, including links that stay inside the root", async (t) => {
    const parent = fixtureRoot();
    const root = path.join(parent, "skills");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    writeSkill(outside, "external");
    writeSkill(root, "internal-target", CONTENT.replaceAll("proofreading", "internal-target"));
    try {
        fs.symlinkSync(outside, path.join(root, "external"), "dir");
        fs.symlinkSync(path.join(outside, "external", "SKILL.md"), path.join(root, "linked-file.md"));
        fs.symlinkSync(path.join(root, "internal-target"), path.join(root, "internal-link"), "dir");
        fs.symlinkSync(path.join(root, "internal-target", "SKILL.md"), path.join(root, "internal-file-link.md"));
        fs.symlinkSync(path.join(parent, "alias"), path.join(parent, "skills-link"), "dir");
        fs.symlinkSync(root, path.join(parent, "alias"), "dir");
    } catch (error) {
        if (process.platform === "win32") return t.skip("symlink creation is unavailable in this Windows environment");
        throw error;
    }

    assert.deepEqual((await new LocalSkillsCatalog(root).list()).map(({ skillId }) => skillId), ["internal-target"]);
    await assert.rejects(new LocalSkillsCatalog(path.join(parent, "skills-link")).list(),
        (error: unknown) => error instanceof LocalSkillsProviderError && error.code === "unavailable");
});

test("content hash is stable across timestamp changes and changes with validated bytes", async () => {
    const root = fixtureRoot();
    const file = writeSkill(root, "proofreading");
    const catalog = new LocalSkillsCatalog(root);
    const first = (await catalog.list())[0]!;
    const earlier = new Date(1_600_000_000_000);
    fs.utimesSync(file, earlier, earlier);
    assert.equal((await catalog.list())[0]?.revision, first.revision);
    fs.writeFileSync(file, `${CONTENT}\n`);
    assert.notEqual((await catalog.list())[0]?.revision, first.revision);
});

test("local manager creates, edits with revision checks, disables loading, and removes only its skill", async () => {
    const root = fixtureRoot();
    const manager = new LocalSkillsManager(root);
    const created = await manager.create({
        skillId: "typescript-review",
        description: "Revisa código TypeScript.",
        instructions: "Procure erros de tipo e explique as correções.",
    });
    assert.equal(created.status, "ok");
    if (created.status !== "ok") assert.fail("expected created skill");
    assert.equal((await manager.list())[0]?.enabled, true);
    assert.match(fs.readFileSync(path.join(root, "typescript-review", "SKILL.md"), "utf8"), /^---\nname: "?typescript-review"?\n/);

    await assert.rejects(manager.edit({
        skillId: "typescript-review",
        revision: "sha256:" + "0".repeat(64),
        description: "Outra descrição.",
        instructions: "Outra instrução.",
    }), (error: unknown) => error instanceof LocalSkillsProviderError && error.code === "stale_revision");

    const edited = await manager.edit({
        skillId: "typescript-review",
        revision: created.revision,
        description: "Revisa TypeScript com cuidado.",
        instructions: "Identifique erros de tipo e proponha correções mínimas.",
    });
    assert.notEqual(edited.revision, created.revision);
    await manager.setEnabled("typescript-review", edited.revision, false);
    assert.equal((await manager.list())[0]?.enabled, false);
    await assert.rejects(manager.load("typescript-review", edited.revision), (error: unknown) =>
        error instanceof LocalSkillsProviderError && error.code === "disabled");

    await assert.rejects(manager.remove("typescript-review", edited.revision, false), /confirmação/i);
    await manager.remove("typescript-review", edited.revision, true);
    assert.deepEqual(await manager.list(), []);
});

test("local manager previews and installs a validated SKILL.md without executing source", async () => {
    const root = fixtureRoot();
    const manager = new LocalSkillsManager(root);
    const preview = manager.previewMarkdown(CONTENT);
    assert.deepEqual(preview, {
        skillId: "proofreading",
        description: "Corrige o texto sem mudar o sentido.",
        instructions: BODY,
    });
    const installed = await manager.installMarkdown(CONTENT, "local-file");
    assert.equal(installed.skillId, "proofreading");
    assert.equal((await manager.list()).length, 1);
    await assert.rejects(manager.installMarkdown(CONTENT, "local-file"), /já existe/i);
});

test("local manager refuses to remove unmanaged files from a skill directory", async () => {
    const root = fixtureRoot();
    const manager = new LocalSkillsManager(root);
    const created = await manager.create({
        skillId: "safe-delete",
        description: "Skill de teste.",
        instructions: "Instruções sintéticas.",
    });
    await fs.promises.writeFile(path.join(root, "safe-delete", "user-data.txt"), "preservar");
    await assert.rejects(
        manager.remove("safe-delete", created.revision, true),
        (error: unknown) => error instanceof LocalSkillsProviderError && error.code === "unavailable",
    );
    assert.equal(fs.readFileSync(path.join(root, "safe-delete", "user-data.txt"), "utf8"), "preservar");
});
