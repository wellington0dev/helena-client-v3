import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browseDirectories, createFile, deleteFile, downloadFile, inspectFile, inspectFiles, listFiles, readFile, searchFiles, writeFile } from "./local-files.ts";

function tempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "helena-local-files-test-"));
}

test("browseDirectories: retorna só subdiretórios e caminho de retorno", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "subpasta"));
    fs.writeFileSync(path.join(dir, "segredo.txt"), "não deve aparecer");

    const result = browseDirectories(dir);

    assert.equal(result.path, dir);
    assert.equal(result.parentPath, path.dirname(dir));
    assert.deepEqual(result.directories.map((entry) => entry.name), ["subpasta"]);
});

test("createFile: cria sem sobrescrever arquivo existente", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "novo.txt");
    assert.deepEqual(createFile(filePath, "primeiro"), { ok: true, bytesWritten: 8 });
    assert.equal(fs.readFileSync(filePath, "utf8"), "primeiro");
    const duplicate = createFile(filePath, "segundo");
    assert.equal(duplicate.ok, false);
    assert.match(duplicate.error!, /já existe/);
    assert.equal(fs.readFileSync(filePath, "utf8"), "primeiro");
});

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

test("downloadFile: retorna base64 e MIME preservando bytes binários", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "apresentacao.pptx");
    const bytes = Buffer.from([0, 255, 12, 128]);
    fs.writeFileSync(filePath, bytes);
    const result = downloadFile(filePath);
    assert.equal(result.error, undefined);
    assert.equal(result.base64, bytes.toString("base64"));
    assert.equal(result.size, bytes.length);
    assert.equal(result.mimeType, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
});

test("downloadFile: aplica teto de 25 MB", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "grande.pdf");
    fs.writeFileSync(filePath, Buffer.alloc(25 * 1024 * 1024 + 1));
    assert.match(downloadFile(filePath).error!, /limite.*25 MB/i);
});

test("downloadFile: política estreita de envio nega quando não há pasta configurada", () => {
    const filePath = path.join(tempDir(), "anexo.txt");
    fs.writeFileSync(filePath, "conteúdo");
    const result = downloadFile(filePath, { allowedDirs: [], deniedPaths: [] });

    assert.equal(result.available, false);
    assert.match(result.error ?? "", /nenhuma pasta liberada/i);
});

test("inspectFile: distingue arquivo existente de referência removida", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "referencia.txt");
    fs.writeFileSync(filePath, "conteúdo");
    assert.equal(inspectFile(filePath).available, true);
    assert.equal(inspectFile(path.join(dir, "removido.txt")).available, false);
});

test("inspectFiles: mantém ordem e limita consultas em lote", () => {
    const dir = tempDir();
    const first = path.join(dir, "a.txt");
    const second = path.join(dir, "b.txt");
    fs.writeFileSync(first, "a");
    fs.writeFileSync(second, "b");
    assert.deepEqual(inspectFiles([second, first]).map((item) => item.available), [true, true]);
    assert.match(inspectFiles(Array.from({ length: 201 }, () => first))[0].error!, /200 arquivos/);
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

test("deleteFile: apaga um arquivo existente de verdade", () => {
    const dir = tempDir();
    const filePath = path.join(dir, "apagar.ts");
    fs.writeFileSync(filePath, "conteudo");

    const result = deleteFile(filePath);

    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(filePath), false);
});

test("deleteFile: arquivo inexistente devolve error, sem lançar", () => {
    const result = deleteFile(path.join(os.tmpdir(), "nao-existe-12345.ts"));
    assert.equal(result.ok, false);
    assert.match(result.error!, /Não consegui apagar/);
});
