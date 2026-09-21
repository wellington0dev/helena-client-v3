import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import stringWidth from "string-width";
import { readGitignoreNames, readWorktree, renderWorktreeLines, truncateToWidth, type WorktreeEntry } from "./worktree.ts";

test("readWorktree: pastas primeiro, ignora node_modules/.git/dist e respeita a profundidade", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-"));
    try {
        fs.mkdirSync(path.join(root, "src", "deep", "deeper", "deepest"), { recursive: true });
        fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
        fs.mkdirSync(path.join(root, ".git"));
        fs.mkdirSync(path.join(root, "dist"));
        fs.writeFileSync(path.join(root, "b.txt"), "");
        fs.writeFileSync(path.join(root, "a.txt"), "");
        fs.writeFileSync(path.join(root, "src", "index.ts"), "");
        const entries = readWorktree(root, 3);
        const names = entries.map((e) => `${e.depth}:${e.name}`);
        assert.deepEqual(names.slice(0, 4), ["0:src", "1:deep", "2:deeper", "1:index.ts"]);
        assert.ok(!names.some((n) => /node_modules|\.git|dist|deepest/.test(n)));
        assert.deepEqual(names.slice(-2), ["0:a.txt", "0:b.txt"]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test("readWorktree: diretório inexistente devolve vazio, sem lançar", () => {
    assert.deepEqual(readWorktree("/caminho/que/nao/existe"), []);
});

test("renderWorktreeLines: desenha ├─/└─ e marca pastas", () => {
    const entries: WorktreeEntry[] = [
        { name: "src", depth: 0, isDir: true },
        { name: "main.ts", depth: 1, isDir: false },
        { name: "util.ts", depth: 1, isDir: false },
        { name: "README.md", depth: 0, isDir: false },
    ];
    assert.deepEqual(renderWorktreeLines(entries, 40, 10), ["├─ ▸ src/", "  ├─ main.ts", "  └─ util.ts", "└─ README.md"]);
});

test("renderWorktreeLines: nunca passa da largura nem do orçamento de linhas", () => {
    const entries: WorktreeEntry[] = Array.from({ length: 30 }, (_, i) => ({ name: `arquivo-com-nome-bem-comprido-${i}.ts`, depth: i % 3, isDir: i % 5 === 0 }));
    const lines = renderWorktreeLines(entries, 20, 8);
    assert.equal(lines.length, 8);
    for (const line of lines) assert.ok(stringWidth(line) <= 20, `"${line}" passou de 20 colunas`);
    assert.match(lines[7]!, /^… \+\d+ itens$/);
});

test("truncateToWidth: corta com … e conta largura visível (acento/emoji)", () => {
    assert.equal(truncateToWidth("abc", 5), "abc");
    assert.equal(truncateToWidth("abcdefgh", 5), "abcd…");
    assert.ok(stringWidth(truncateToWidth("áéíóúáéíóú", 6)) <= 6);
    assert.equal(truncateToWidth("x", 0), "");
});

test("readGitignoreNames/readWorktree: respeita nomes simples do .gitignore da raiz e ignora glob/negação", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wt-"));
    try {
        fs.writeFileSync(path.join(root, ".gitignore"), "# c\nout/\n/tmp\n*.log\n!keep\nsub/dir\n.env\n");
        fs.mkdirSync(path.join(root, "out"));
        fs.mkdirSync(path.join(root, "tmp"));
        fs.mkdirSync(path.join(root, "src"));
        fs.writeFileSync(path.join(root, ".env"), "");
        fs.writeFileSync(path.join(root, "a.log"), "");
        assert.deepEqual([...readGitignoreNames(root)].sort(), [".env", "out", "tmp"]);
        assert.deepEqual(readWorktree(root).map((e) => e.name), ["src", ".gitignore", "a.log"]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
