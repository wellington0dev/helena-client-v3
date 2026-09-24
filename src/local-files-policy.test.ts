import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HOME falso ANTES de importar (config/política leem o home) — com uma chave SSH e um .env de mentira dentro.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "helena-policy-test-"));
process.env.HOME = home;
fs.mkdirSync(path.join(home, ".ssh"));
fs.writeFileSync(path.join(home, ".ssh", "id_rsa"), "SEGREDO-CHAVE-PRIVADA\n");
fs.writeFileSync(path.join(home, ".env"), "API_KEY=SEGREDO-ENV\n");
fs.mkdirSync(path.join(home, "projeto"));
fs.writeFileSync(path.join(home, "projeto", "app.ts"), "const x = 'SEGREDO-NAO: texto normal';\n");
fs.symlinkSync(path.join(home, ".ssh"), path.join(home, "projeto", "atalho-ssh"));

const { grepFiles, globFiles, previewDiff } = await import("./local-files.ts");
const { runCommand } = await import("./local-shell.ts");

test("grepFiles no HOME: nunca lê ~/.ssh nem .env (antes lia — grep não passava pelo guard)", () => {
    const { matches, error } = grepFiles(home, "SEGREDO");
    assert.equal(error, undefined);
    const files = matches.map((m) => m.file);
    assert.ok(files.some((f) => f.endsWith(path.join("projeto", "app.ts"))), "o arquivo normal continua aparecendo");
    assert.ok(!files.some((f) => f.includes(`${path.sep}.ssh${path.sep}`) || f.includes("atalho-ssh")), `leu pasta protegida: ${files.join(", ")}`);
    assert.ok(!files.some((f) => path.basename(f) === ".env"), "leu .env");
});

test("grepFiles com a raiz numa pasta protegida → erro, nenhuma linha", () => {
    const { matches, error } = grepFiles(path.join(home, ".ssh"), "SEGREDO");
    assert.equal(matches.length, 0);
    assert.match(error ?? "", /Acesso negado/);
});

test("grepFiles não segue symlink pra ~/.ssh de dentro de uma pasta liberada", () => {
    const { matches } = grepFiles(path.join(home, "projeto"), "CHAVE-PRIVADA");
    assert.equal(matches.length, 0);
});

test("globFiles: não lista nomes dentro de pastas protegidas nem arquivos sensíveis", () => {
    const { paths, error } = globFiles(home, "*");
    assert.equal(error, undefined);
    assert.ok(paths.some((p) => p.endsWith("app.ts")));
    assert.ok(!paths.some((p) => p.includes(`${path.sep}.ssh`) || path.basename(p) === ".env" || path.basename(p) === "id_rsa"), paths.join(", "));
    assert.match(globFiles(path.join(home, ".ssh"), "*").error ?? "", /Acesso negado/);
});

test("previewDiff: não mostra o conteúdo de arquivo protegido (o diff exibe o original)", () => {
    const result = previewDiff(path.join(home, ".env"), [{ type: "replace_all", content: "x" }] as never);
    assert.match(result.error ?? "", /Acesso negado/);
    assert.ok(!result.diff.includes("SEGREDO-ENV"));
});

test("shell: diretório de trabalho numa pasta protegida é recusado", async () => {
    const result = await runCommand("ls", path.join(home, ".ssh"));
    assert.equal(result.code, null);
    assert.match(result.stderr, /Acesso negado ao diretório de trabalho/);
    assert.ok(!result.stdout.includes("id_rsa"));
});

test("shell: diretório comum continua funcionando", async () => {
    const result = await runCommand("ls", path.join(home, "projeto"));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /app\.ts/);
});

// --- Política EXTRA de contato (só restringe) ---
const { listFiles, readFile, writeFile } = await import("./local-files.ts");
fs.mkdirSync(path.join(home, "projeto", "interno"));
fs.writeFileSync(path.join(home, "projeto", "pedido.pdf"), "PDF");
fs.writeFileSync(path.join(home, "projeto", "interno", "salario.pdf"), "SAL");
const narrow = { allowedDirs: [path.join(home, "projeto")], deniedPaths: [path.join(home, "projeto", "interno")], allowedExtensions: ["pdf"] };

test("contato: lê arquivo liberado; tipo não liberado e pasta negada são recusados", () => {
    assert.equal(readFile(path.join(home, "projeto", "pedido.pdf"), narrow).content, "PDF");
    assert.match(readFile(path.join(home, "projeto", "app.ts"), narrow).error ?? "", /tipo de arquivo não liberado/);
    assert.match(readFile(path.join(home, "projeto", "interno", "salario.pdf"), narrow).error ?? "", /Acesso negado/);
});

test("contato: listFiles esconde tipo não liberado e pasta negada", () => {
    const names = listFiles(path.join(home, "projeto"), undefined, narrow).files.map((f) => f.name).sort();
    assert.deepEqual(names, ["pedido.pdf"]); // app.ts (tipo), interno/ (negada) e atalho-ssh (política base) somem
});

test("contato: allowedDirs VAZIO nega tudo (na política base vazio = liberado — esse sentido não pode vazar)", () => {
    assert.match(readFile(path.join(home, "projeto", "pedido.pdf"), { allowedDirs: [], deniedPaths: [] }).error ?? "", /nenhuma pasta liberada/);
});

test("contato: restringir NUNCA amplia — pasta que a política base protege continua protegida", () => {
    const wide = { allowedDirs: [home], deniedPaths: [], allowedExtensions: ["pdf", "txt"] };
    assert.match(readFile(path.join(home, ".ssh", "id_rsa"), wide).error ?? "", /Acesso negado/);
});

test("contato: escrita respeita pasta e tipo", () => {
    const w = { allowedDirs: [path.join(home, "projeto")], deniedPaths: [], allowedExtensions: ["txt"] };
    assert.equal(writeFile(path.join(home, "projeto", "novo.txt"), [{ type: "replace_all", content: "oi" }] as never, w).error, undefined);
    assert.match(writeFile(path.join(home, "projeto", "novo.sh"), [{ type: "replace_all", content: "rm -rf" }] as never, w).error ?? "", /tipo de arquivo não liberado/);
});
