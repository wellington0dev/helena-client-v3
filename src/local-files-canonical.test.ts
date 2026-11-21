import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HOME falso ANTES do import — config/política leem o home no module-load.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "helena-canonical-test-"));
process.env.HOME = home;
const projeto = path.join(home, "projeto");
fs.mkdirSync(projeto);
fs.writeFileSync(path.join(projeto, "segredo.pdf"), "SEGREDO-PDF");
// Link .txt dentro da pasta liberada apontando para um .pdf: a política de tipo
// deve ser avaliada no alvo real, não no nome do link (era o bug).
fs.symlinkSync(path.join(projeto, "segredo.pdf"), path.join(projeto, "notas.txt"));
fs.writeFileSync(path.join(projeto, "app.ts"), "SEGREDO-TS");
fs.writeFileSync(path.join(home, ".env"), "API_KEY=SEGREDO-ENV");

const { readFile, downloadFile, inspectFiles, grepFiles, globFiles, previewDiff, deleteFile } = await import("./local-files.ts");
const narrowTxt = { allowedDirs: [projeto], deniedPaths: [], allowedExtensions: ["txt"] };
const narrowEmpty = { allowedDirs: [], deniedPaths: [] };

test("readFile usa o caminho canônico: symlink .txt -> .pdf é negado pela política de tipo", () => {
    const result = readFile(path.join(projeto, "notas.txt"), narrowTxt);
    assert.equal(result.content, "", "conteúdo do .pdf vazou através do symlink .txt");
    assert.match(result.error ?? "", /tipo de arquivo não liberado|Acesso negado/);
});

test("readFile: sem política estreita o link legítimo continua legível", () => {
    const result = readFile(path.join(projeto, "notas.txt"));
    assert.equal(result.error, undefined);
    assert.equal(result.content, "SEGREDO-PDF");
});

test("downloadFile repassa NarrowPolicy (tipo e pasta)", () => {
    assert.match(downloadFile(path.join(projeto, "app.ts"), narrowTxt).error ?? "", /tipo de arquivo não liberado/);
    assert.match(downloadFile(path.join(projeto, "notas.txt"), narrowEmpty).error ?? "", /nenhuma pasta liberada/);
});

test("inspectFiles repassa NarrowPolicy", () => {
    const [result] = inspectFiles([path.join(projeto, "app.ts")], narrowTxt);
    assert.match(result.error ?? "", /tipo de arquivo não liberado/);
});

test("grepFiles repassa NarrowPolicy (allowedDirs vazio nega)", () => {
    const result = grepFiles(projeto, "SEGREDO", undefined, narrowEmpty);
    assert.equal(result.matches.length, 0);
    assert.match(result.error ?? "", /nenhuma pasta liberada|Acesso negado/);
});

test("globFiles repassa NarrowPolicy (allowedDirs vazio nega)", () => {
    const result = globFiles(projeto, "*", narrowEmpty);
    assert.equal(result.paths.length, 0);
    assert.match(result.error ?? "", /nenhuma pasta liberada|Acesso negado/);
});

test("previewDiff e deleteFile repassam NarrowPolicy", () => {
    assert.match(previewDiff(path.join(projeto, "app.ts"), [{ type: "replace_all", content: "x" }] as never, narrowTxt).error ?? "", /tipo de arquivo não liberado|Acesso negado/);
    assert.match(deleteFile(path.join(projeto, "app.ts"), narrowTxt).error ?? "", /tipo de arquivo não liberado|Acesso negado/);
    assert.ok(fs.existsSync(path.join(projeto, "app.ts")), "deleteFile apagou apesar da política");
});

test("política base continua protegendo .env mesmo com allowAllDirs", () => {
    const wide = { allowedDirs: [], deniedPaths: [], allowAllDirs: true };
    assert.match(readFile(path.join(home, ".env"), wide).error ?? "", /Acesso negado/);
});
