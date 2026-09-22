import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import stringWidth from "string-width";
import { ignoredNames, readGitignoreNames, truncateToWidth } from "./worktree.ts";

test("truncateToWidth: corta com … e conta largura visível (acento/emoji)", () => {
    assert.equal(truncateToWidth("abc", 5), "abc");
    assert.equal(truncateToWidth("abcdefgh", 5), "abcd…");
    assert.ok(stringWidth(truncateToWidth("áéíóúáéíóú", 6)) <= 6);
    assert.equal(truncateToWidth("x", 0), "");
});

test("readGitignoreNames/ignoredNames: respeita nomes simples do .gitignore da raiz, ignora glob/negação, e ignoredNames soma com os fixos (node_modules etc.)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-"));
    try {
        fs.writeFileSync(path.join(root, ".gitignore"), "# c\nout/\n/tmp\n*.log\n!keep\nsub/dir\n.env\n");
        const gitignoreNames = readGitignoreNames(root);
        assert.deepEqual([...gitignoreNames].sort(), [".env", "out", "tmp"]);

        const combined = ignoredNames(root);
        assert.ok(combined.has(".env") && combined.has("out") && combined.has("tmp"));
        assert.ok(combined.has("node_modules") && combined.has(".git")); // fixos, mesmo sem estar no .gitignore.
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("readGitignoreNames: diretório sem .gitignore devolve vazio, sem lançar", () => {
    assert.deepEqual(readGitignoreNames("/caminho/que/nao/existe"), new Set());
});
