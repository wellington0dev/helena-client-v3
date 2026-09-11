import { test } from "node:test";
import assert from "node:assert/strict";
import { formatToolCall, formatToolResult } from "./format-tool-call.ts";

test("formatToolCall: shell mostra o comando, label 'Bash'", () => {
    assert.equal(formatToolCall("shell", { command: "npm test" }), "Bash(npm test)");
});

test("formatToolCall: write_file/read_file mostram o path, labels 'Write'/'Read'", () => {
    assert.equal(formatToolCall("write_file", { path: "src/app.ts", edits: [] }), "Write(src/app.ts)");
    assert.equal(formatToolCall("read_file", { path: "README.md" }), "Read(README.md)");
});

test("formatToolCall: tool desconhecida cai no fallback nome + JSON compacto", () => {
    assert.equal(formatToolCall("create_task", { title: "Ligar pro cliente" }), 'create_task({"title":"Ligar pro cliente"})');
});

test("formatToolCall: sem input nenhum, só o label/nome", () => {
    assert.equal(formatToolCall("list_projects", undefined), "list_projects");
});

test("formatToolCall: comando/JSON muito longo é truncado com reticência", () => {
    const longCommand = "x".repeat(200);
    const out = formatToolCall("shell", { command: longCommand });
    assert.ok(out.length < 120);
    assert.match(out, /…\)$/);
});

test("formatToolResult: shell mostra stdout, ignora stderr vazio", () => {
    assert.equal(formatToolResult("shell", { stdout: "a.txt\nb.txt\n", stderr: "", code: 0 }), "a.txt\nb.txt");
});

test("formatToolResult: shell com erro mostra stdout + stderr juntos", () => {
    assert.equal(formatToolResult("shell", { stdout: "", stderr: "comando não encontrado", code: 127 }), "comando não encontrado");
});

test("formatToolResult: shell sem saída nenhuma mostra placeholder", () => {
    assert.equal(formatToolResult("shell", { stdout: "", stderr: "", code: 0 }), "(sem saída)");
});

test("formatToolResult: tool com {error} mostra a mensagem de erro direto", () => {
    assert.equal(formatToolResult("read_file", { content: "", error: "arquivo não encontrado" }), "arquivo não encontrado");
});

test("formatToolResult: tool genérica sem shape conhecido cai no JSON compacto", () => {
    assert.equal(formatToolResult("create_task", { id: "t1", title: "Ligar" }), '{"id":"t1","title":"Ligar"}');
});

test("formatToolResult: mais de 6 linhas corta e mostra quantas faltam", () => {
    const stdout = Array.from({ length: 10 }, (_, i) => `linha ${i}`).join("\n");
    const out = formatToolResult("shell", { stdout, stderr: "" });
    assert.equal(out.split("\n").length, 7); // 6 linhas + marcador
    assert.match(out, /\(\+4 linhas\)$/);
});
