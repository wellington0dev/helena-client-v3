import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GitHubSkillImporter } from "./github-skills.ts";
import { LocalSkillsManager } from "./local-skills-management.ts";

const markdown = "---\nname: external-design\ndescription: External design skill.\n---\n\nUse explicit constraints and trade-offs.\n";

test("preview and install flow writes the selected GitHub skill to the local library", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "helena-skill-install-test-"));
    const fetcher = (async (input) => {
        const url = String(input);
        if (url.endsWith("/repos/acme/skills")) return Response.json({ default_branch: "main" });
        if (url.includes("/branches?")) return Response.json([{ name: "main", commit: { sha: "a".repeat(40) } }]);
        if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree: [
            { path: "skills/design/SKILL.md", type: "blob", sha: "c".repeat(40), size: Buffer.byteLength(markdown) },
            { path: "skills/other/SKILL.md", type: "blob", sha: "d".repeat(40), size: Buffer.byteLength(markdown) },
        ] });
        if (url.includes("raw.githubusercontent.com") && url.includes("/skills/design/")) return new Response(markdown);
        if (url.includes("raw.githubusercontent.com") && url.includes("/skills/other/")) return new Response(markdown.replace("external-design", "external-other"));
        throw new Error(`Unexpected GitHub request: ${url}`);
    }) as typeof fetch;
    const manager = new LocalSkillsManager(path.join(root, "skills"), new GitHubSkillImporter(fetcher));

    try {
        const catalog = await manager.previewGit("https://github.com/acme/skills");
        assert.equal(catalog.kind, "catalog");
        assert.equal((catalog.skills as unknown[]).length, 2);

        const selected = await manager.previewGit("https://github.com/acme/skills", "skills/design");
        assert.equal(selected.kind, "preview");
        assert.equal(selected.skillId, "external-design");
        assert.match(String(selected.instructions), /explicit constraints/);

        const installed = await manager.installGit(String(selected.source), String(selected.skillPath), String(selected.sourceRevision));
        assert.equal(installed.skillId, "external-design");
        const library = await manager.list();
        assert.deepEqual(library.map((skill) => skill.skillId), ["external-design"]);
        assert.match(fs.readFileSync(path.join(root, "skills", "external-design", "SKILL.md"), "utf8"), /explicit constraints/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
