import assert from "node:assert/strict";
import test from "node:test";
import {
    GitHubSkillImporter,
    GitHubSkillImportError,
    parseGitHubSkillSource,
} from "./github-skills.ts";

const SKILL = "---\nname: system-design\ndescription: Design reliable systems.\n---\n\nThink through constraints.\n";

test("normalizes GitHub repository, .git, tree, blob, and raw SKILL.md URLs", () => {
    assert.deepEqual(parseGitHubSkillSource("https://github.com/acme/skills.git"), {
        owner: "acme", repo: "skills",
    });
    assert.deepEqual(parseGitHubSkillSource("https://github.com/acme/skills/tree/main/skills/design"), {
        owner: "acme", repo: "skills", locator: ["main", "skills", "design"],
    });
    assert.deepEqual(parseGitHubSkillSource("https://github.com/acme/skills/blob/main/skills/design/SKILL.md"), {
        owner: "acme", repo: "skills", locator: ["main", "skills", "design", "SKILL.md"],
    });
    assert.deepEqual(parseGitHubSkillSource("https://raw.githubusercontent.com/acme/skills/main/skills/design/SKILL.md"), {
        owner: "acme", repo: "skills", locator: ["main", "skills", "design", "SKILL.md"],
    });
});

test("rejects lookalike hosts, credentials, ports, and traversal before making requests", () => {
    for (const source of [
        "https://github.com.attacker.test/acme/skills",
        "https://github.com@127.0.0.1/acme/skills",
        "https://github.com:8443/acme/skills",
        "https://github.com/acme/skills/tree/main/%2e%2e/private",
    ]) assert.throws(() => parseGitHubSkillSource(source));
});

test("discovers multiple root skills and resolves slash-containing branches through branch metadata", async () => {
    const calls: string[] = [];
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/repos/acme/skills")) return Response.json({ default_branch: "feature/design" });
        if (url.includes("/branches?")) return Response.json([{ name: "main", commit: { sha: "a".repeat(40) } }, { name: "feature/design", commit: { sha: "b".repeat(40) } }]);
        if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree: [
            { path: "skills/design/SKILL.md", type: "blob", sha: "c".repeat(40) },
            { path: "skills/testing/SKILL.md", type: "blob", sha: "d".repeat(40) },
        ] });
        if (url.includes("raw.githubusercontent.com")) return new Response(SKILL.replace("system-design", url.includes("/testing/") ? "testing" : "system-design"));
        throw new Error(`Unexpected GitHub API request: ${url}`);
    };
    const importer = new GitHubSkillImporter(fetcher as typeof fetch);

    const catalog = await importer.discover("https://github.com/acme/skills");

    assert.equal(catalog.skills.length, 2);
    assert.deepEqual(catalog.skills.map(skill => skill.skillPath), ["skills/design", "skills/testing"]);
    assert.equal(catalog.ref, "feature/design");
    assert.ok(calls.some(url => url.includes("/branches?")));

    const scoped = await importer.discover("https://github.com/acme/skills/tree/feature/design/skills/design");
    assert.equal(scoped.ref, "feature/design");
    assert.deepEqual(scoped.skills.map(skill => skill.skillPath), ["skills/design"]);
});

test("requires explicit acknowledgement before installing only SKILL.md when auxiliary files exist", async () => {
    const fetcher = (async (input) => {
        const url = String(input);
        if (url.endsWith("/repos/acme/skills")) return Response.json({ default_branch: "main" });
        if (url.includes("/branches?")) return Response.json([{ name: "main", commit: { sha: "a".repeat(40) } }]);
        if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree: [
            { path: "skills/design/SKILL.md", type: "blob", sha: "c".repeat(40) },
            { path: "skills/design/references/guide.md", type: "blob", sha: "d".repeat(40) },
        ] });
        if (url.includes("raw.githubusercontent.com")) return new Response(SKILL);
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;
    const importer = new GitHubSkillImporter(fetcher);
    const preview = await importer.preview("https://github.com/acme/skills/tree/main/skills/design", "skills/design");
    assert.deepEqual(preview.unsupportedFiles, ["references/guide.md"]);
    await assert.rejects(importer.installSource(preview.source, preview.skillPath, preview.sourceRevision), (error: unknown) =>
        error instanceof GitHubSkillImportError && error.code === "unsupported_files");
    assert.equal(await importer.installSource(preview.source, preview.skillPath, preview.sourceRevision, true), SKILL);
});

test("fails closed on GitHub redirects and gives a specific private-or-inaccessible repository error", async () => {
    const redirected = new GitHubSkillImporter((async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } })) as typeof fetch);
    await assert.rejects(redirected.discover("https://github.com/acme/skills"), (error: unknown) =>
        error instanceof GitHubSkillImportError && error.code === "network");

    const privateRepo = new GitHubSkillImporter((async () => new Response(null, { status: 404 })) as typeof fetch);
    await assert.rejects(privateRepo.discover("https://github.com/acme/private"), (error: unknown) =>
        error instanceof GitHubSkillImportError && /privado\/sem acesso público/.test(error.message));
});

test("returns a bounded selected preview and refuses oversized files", async () => {
    const fetcher = async (input: string | URL | Request): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/repos/acme/skills")) return Response.json({ default_branch: "main" });
        if (url.includes("/branches?")) return Response.json([{ name: "main", commit: { sha: "a".repeat(40) } }]);
        if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ path: "skills/design/SKILL.md", type: "blob", sha: "c".repeat(40) }] });
        if (url.includes("raw.githubusercontent.com")) return new Response(SKILL);
        throw new Error(`Unexpected GitHub API request: ${url}`);
    };
    const importer = new GitHubSkillImporter(fetcher as typeof fetch);
    const catalog = await importer.discover("https://github.com/acme/skills/tree/main/skills/design");
    const preview = await importer.preview(catalog.source, catalog.skills[0]!.skillPath);
    assert.equal(preview.skillId, "system-design");
    assert.equal(preview.instructions, "Think through constraints.");

    const oversized = new GitHubSkillImporter((async (input) => {
        const url = String(input);
        if (url.endsWith("/repos/acme/skills")) return Response.json({ default_branch: "main" });
        if (url.includes("/branches?")) return Response.json([{ name: "main", commit: { sha: "a".repeat(40) } }]);
        if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ path: "SKILL.md", type: "blob", sha: "c".repeat(40) }] });
        if (url.includes("raw.githubusercontent.com")) return new Response("x".repeat(33 * 1024));
        throw new Error("Unexpected request");
    }) as typeof fetch);
    await assert.rejects(oversized.discover("https://github.com/acme/skills"), (error: unknown) =>
        error instanceof GitHubSkillImportError && error.code === "payload_too_large");
});

test("rejects truncated trees and catalogs above the configured skill limit", async () => {
    const ownerRepo = (tree: Record<string, unknown>) => new GitHubSkillImporter((async (input) => {
        const url = String(input);
        if (url.endsWith("/repos/acme/skills")) return Response.json({ default_branch: "main" });
        if (url.includes("/branches?")) return Response.json([{ name: "main", commit: { sha: "a".repeat(40) } }]);
        if (url.includes("/git/trees/")) return Response.json(tree);
        throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch);

    const truncated = ownerRepo({ truncated: true, tree: [] });
    await assert.rejects(truncated.discover("https://github.com/acme/skills"), (error: unknown) =>
        error instanceof GitHubSkillImportError && error.code === "payload_too_large");

    const tooMany = ownerRepo({
        truncated: false,
        tree: Array.from({ length: 251 }, (_, index) => ({
            path: `skills/skill-${index}/SKILL.md`, type: "blob", sha: index.toString(16).padStart(40, "0"), size: 100,
        })),
    });
    await assert.rejects(tooMany.discover("https://github.com/acme/skills"), (error: unknown) =>
        error instanceof GitHubSkillImportError && error.code === "payload_too_large");
});
