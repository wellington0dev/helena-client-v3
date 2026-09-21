import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyMention, findMentionToken, listProjectFiles, matchFiles } from "./file-mentions.ts";

test("findMentionToken: acha o @ no fim, só depois de espaço ou no começo", () => {
    assert.deepEqual(findMentionToken("@src/ma"), { start: 0, query: "src/ma" });
    assert.deepEqual(findMentionToken("leia o @pack"), { start: 7, query: "pack" });
    assert.deepEqual(findMentionToken("leia @"), { start: 5, query: "" });
    assert.equal(findMentionToken("meu email é a@b.com"), undefined);
    assert.equal(findMentionToken("@src/main.ts já completo e seguimos"), undefined);
    assert.equal(findMentionToken(""), undefined);
});

test("matchFiles: nome começando com o termo vence; sem termo, os mais rasos primeiro; respeita o limite", () => {
    const files = ["src/deep/app.ts", "app.ts", "docs/application.md", "src/zapp.ts", "README.md"];
    assert.deepEqual(matchFiles(files, "app").slice(0, 3), ["app.ts", "src/deep/app.ts", "docs/application.md"]);
    assert.deepEqual(matchFiles(files, "", 2), ["app.ts", "README.md"]);
    assert.deepEqual(matchFiles(files, "nao-existe"), []);
    assert.equal(matchFiles(files, "a", 2).length, 2);
});

test("matchFiles: ignora maiúsculas/minúsculas", () => {
    assert.deepEqual(matchFiles(["ReadMe.md"], "readme"), ["ReadMe.md"]);
});

test("applyMention: troca só o trecho @ do fim e deixa um espaço pra continuar digitando", () => {
    const value = "leia o @pack";
    assert.equal(applyMention(value, findMentionToken(value)!, "package.json"), "leia o @package.json ");
});

test("listProjectFiles: caminhos relativos, ignora node_modules/.git/dist e o .gitignore da raiz", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fm-"));
    try {
        fs.mkdirSync(path.join(root, "src"));
        fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
        fs.mkdirSync(path.join(root, "out"));
        fs.writeFileSync(path.join(root, ".gitignore"), "out/\n");
        fs.writeFileSync(path.join(root, "README.md"), "");
        fs.writeFileSync(path.join(root, "src", "main.ts"), "");
        fs.writeFileSync(path.join(root, "node_modules", "x", "i.js"), "");
        fs.writeFileSync(path.join(root, "out", "bundle.js"), "");
        assert.deepEqual(listProjectFiles(root).sort(), [".gitignore", "README.md", "src/main.ts"]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
