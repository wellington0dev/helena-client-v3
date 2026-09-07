import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./local-shell.ts";

test("runCommand: stdout/código de saída de um comando simples", async () => {
    const result = await runCommand("echo ola-mundo");
    assert.equal(result.stdout.trim(), "ola-mundo");
    assert.equal(result.code, 0);
});

test("runCommand: código de saída não-zero e stderr de um comando que falha", async () => {
    const result = await runCommand("echo deu-erro >&2; exit 3");
    assert.equal(result.code, 3);
    assert.equal(result.stderr.trim(), "deu-erro");
});

test("runCommand: respeita cwd", async () => {
    const result = await runCommand("pwd", "/tmp");
    assert.equal(result.stdout.trim(), "/tmp");
});

test("runCommand: expande '~' pro home do usuário", async () => {
    const result = await runCommand("pwd", "~");
    assert.equal(result.stdout.trim(), os.homedir());
});

test("runCommand: comando não encontrado vira código de saída do shell (127), não trava", async () => {
    const result = await runCommand("um-comando-que-nao-existe-de-verdade-12345");
    assert.equal(result.code, 127);
});

test("runCommand: comando em SEGUNDO PLANO (ex: 'comando &') resolve rápido — bug real corrigido (não trava até o timeout de 30s)", async () => {
    const start = Date.now();
    // O processo em segundo plano herda o MESMO stdout/stderr — antes da
    // correção, isso travava até TIMEOUT_MS porque exec()/execFile()
    // esperavam o pipe fechar de vez, o que só aconteceria quando ESSE
    // processo (que dorme de propósito bem mais que o teste toleraria)
    // terminasse.
    const result = await runCommand("sleep 5 &");
    const elapsedMs = Date.now() - start;

    assert.ok(elapsedMs < 3000, `esperava resolver em bem menos de 3s (comando em segundo plano), levou ${elapsedMs}ms`);
    assert.equal(result.code, 0);
});

test("runCommand: processo em segundo plano que escreve no stdout DEPOIS da resposta não quebra por EPIPE — segundo bug real corrigido (pipe vira EPIPE quando o leitor solta; arquivo não)", async () => {
    const marker = path.join(os.tmpdir(), `helena-shell-test-marker-${Date.now()}`);
    await runCommand(`(sleep 0.3; echo oi-depois-do-retorno; touch ${marker}) &`);

    // Dá tempo do processo em segundo plano terminar de verdade — se ele
    // morresse por EPIPE ao tentar escrever no stdout (bug real: pipe sem
    // leitor gera EPIPE; arquivo não), o `touch` depois do `echo` nunca
    // rodaria e o marcador nunca apareceria.
    await new Promise((resolve) => setTimeout(resolve, 900));

    assert.ok(fs.existsSync(marker), "processo em segundo plano deveria ter completado (escrito no stdout e criado o marcador) sem morrer por EPIPE");
    fs.unlinkSync(marker);
});

test("runCommand: saída MUITO longa é truncada, não devolvida inteira", async () => {
    const result = await runCommand("yes x | head -c 30000");
    assert.ok(result.stdout.length < 25000);
    assert.match(result.stdout, /saída truncada/);
});
