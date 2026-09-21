import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readGitBranch } from "./git-branch.ts";

function tmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "gb-"));
}

test("readGitBranch: lê a branch de .git/HEAD, inclusive de uma subpasta", () => {
    const root = tmp();
    try {
        fs.mkdirSync(path.join(root, ".git"));
        fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/feat/minha-branch\n");
        fs.mkdirSync(path.join(root, "src", "a"), { recursive: true });
        assert.equal(readGitBranch(root), "feat/minha-branch");
        assert.equal(readGitBranch(path.join(root, "src", "a")), "feat/minha-branch");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("readGitBranch: HEAD solto devolve o commit curto; arquivo .git (worktree) é seguido", () => {
    const root = tmp();
    try {
        fs.mkdirSync(path.join(root, "real-git"));
        fs.writeFileSync(path.join(root, "real-git", "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
        fs.mkdirSync(path.join(root, "wt"));
        fs.writeFileSync(path.join(root, "wt", ".git"), `gitdir: ${path.join(root, "real-git")}\n`);
        assert.equal(readGitBranch(path.join(root, "wt")), "0123456");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("readGitBranch: fora de repositório não lança", () => {
    const root = tmp();
    try {
        // /tmp pode estar dentro de um repo em alguns setups; o contrato é só não lançar
        const result = readGitBranch(root);
        assert.ok(result === undefined || typeof result === "string");
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
