import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFiles, readFile, searchFiles, writeFile } from "./local-files.ts";

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "helena-local-files-test-"));
}

test("listFiles: lista arquivos e pastas com nome/isDirectory/size corretos", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.ts"), "conteudo");
    fs.mkdirSync(path.join(dir, "subpasta"));

    const result = listFiles(dir);

    assert.equal(result.error, undefined);
    const names = result.files.map((f) => f.name).sort();
    assert.deepEqual(names, ["a.ts", "subpasta"]);
    const file = result.files.find((f) => f.name === "a.ts")!;
    assert.equal(file.isDirectory, false);
    assert.equal(file.size, "conteudo".length);
    const dirEntry = result.files.find((f) => f.name === "subpasta")!;
    assert.equal(dirEntry.isDirectory, true);
});

test("listFiles: pattern filtra por nome (regex)", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.ts"), "");
    fs.writeFileSync(path.join(dir, "b.md"), "");

    const result = listFiles(dir, "\\.ts$");

    assert.deepEqual(result.files.map((f) => f.name), ["a.ts"]);
});

test("listFiles: diretório inexistente devolve error, sem lançar", () => {
    const result = listFiles(path.join(os.tmpdir(), "nao-existe-de-verdade-12345"));
    assert.equal(result.files.length, 0);
    assert.match(result.error!, /Não consegui listar/);
});

test("readFile: lê conteúdo real de um arquivo de texto", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "arquivo.txt");
    fs.writeFileSync(filePath, "linha 1\nlinha 2\n");

    const result = readFile(filePath);

    assert.equal(result.content, "linha 1\nlinha 2\n");
    assert.equal(result.error, undefined);
});

test("readFile: arquivo inexistente devolve error, content vazio", () => {
    const result = readFile(path.join(os.tmpdir(), "nao-existe-12345.txt"));
    assert.equal(result.content, "");
    assert.match(result.error!, /Não consegui ler/);
});

test("readFile: diretório (não arquivo) devolve error específico", () => {
    const dir = tempDir();
    const result = readFile(dir);
    assert.match(result.error!, /é um diretório/);
});

test("searchFiles: por nome e por conteúdo, ignorando node_modules", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "achar.ts"), "TODO: revisar isto");
    fs.writeFileSync(path.join(dir, "outro.ts"), "nada aqui");
    fs.mkdirSync(path.join(dir, "node_modules"));
    fs.writeFileSync(path.join(dir, "node_modules", "achar.ts"), "TODO: nunca deveria aparecer");

    const byName = searchFiles(dir, "^achar\\.ts$");
    assert.equal(byName.paths.length, 1);
    assert.equal(byName.paths[0], path.join(dir, "achar.ts"));

    const byContent = searchFiles(dir, undefined, "TODO");
    assert.equal(byContent.paths.length, 1);
    assert.equal(byContent.paths[0], path.join(dir, "achar.ts"));
});

test("searchFiles: sem nenhum padrão devolve error", () => {
    const result = searchFiles(tempDir());
    assert.match(result.error!, /Informe namePattern/);
});

test("writeFile: replace_all cria arquivo novo do zero (inclusive pasta que não existia)", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "nova-pasta", "arquivo.ts");

    const result = writeFile(filePath, [{ type: "replace_all", content: "export const x = 1;" }]);

    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, "utf8"), "export const x = 1;");
});

test("writeFile: replace_all combinado com outro edit é rejeitado", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "arquivo.ts");

    const result = writeFile(filePath, [
        { type: "replace_all", content: "x" },
        { type: "add", startLine: 1, content: "y" },
    ]);

    assert.equal(result.ok, false);
    assert.match(result.error!, /não pode ser combinado/);
});

test("writeFile: add insere na linha certa, sem mexer no resto", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "arquivo.ts");
    fs.writeFileSync(filePath, "linha 1\nlinha 2\nlinha 3");

    const result = writeFile(filePath, [{ type: "add", startLine: 2, content: "inserida" }]);

    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, "utf8"), "linha 1\ninserida\nlinha 2\nlinha 3");
});

test("writeFile: remove um intervalo de linhas", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "arquivo.ts");
    fs.writeFileSync(filePath, "linha 1\nlinha 2\nlinha 3\nlinha 4");

    const result = writeFile(filePath, [{ type: "remove", startLine: 2, endLine: 3 }]);

    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, "utf8"), "linha 1\nlinha 4");
});

test("writeFile: remove em arquivo inexistente é erro real (nunca finge sucesso)", () => {
    const result = writeFile(path.join(os.tmpdir(), "nao-existe-12345.ts"), [{ type: "remove", startLine: 1, endLine: 1 }]);
    assert.equal(result.ok, false);
    assert.match(result.error!, /Não consegui ler/);
});

test("writeFile: múltiplos edits aplicam corretamente independente da ORDEM do array (sempre de baixo pra cima por posição)", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "arquivo.ts");
    fs.writeFileSync(filePath, "linha 1\nlinha 2\nlinha 3");

    // Array em ordem "errada" de propósito (linha maior primeiro) — resultado deve ser IGUAL ao caso ordenado certo.
    const result = writeFile(filePath, [
        { type: "add", startLine: 1, content: "topo" },
        { type: "add", startLine: 3, content: "meio" },
    ]);

    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, "utf8"), "topo\nlinha 1\nlinha 2\nmeio\nlinha 3");
});

test("writeFile: add cria arquivo novo quando ele ainda não existe", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "arquivo-novo.ts");

    const result = writeFile(filePath, [{ type: "add", startLine: 1, content: "export const x = 1;" }]);

    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(filePath, "utf8"), "export const x = 1;\n");
});
