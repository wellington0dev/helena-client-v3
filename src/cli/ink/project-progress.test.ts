import { test } from "node:test";
import assert from "node:assert/strict";
import { formatProjectChecklist, formatProjectSummary } from "./project-progress.ts";

test("formatProjectChecklist: uma linha por step, na ordem fixa (architect antes de frontend, mesmo criado depois)", () => {
    const lines = formatProjectChecklist({ frontend: "running", architect: "done" });
    assert.deepEqual(lines, ["✓ Arquiteta (concluído)", "◐ Frontend (rodando)"]);
});

test("formatProjectChecklist: só os papéis que o Project realmente tem", () => {
    const lines = formatProjectChecklist({ backend: "ready" });
    assert.deepEqual(lines, ["○ Backend (na fila)"]);
});

test("formatProjectChecklist: cobre os 4 status com ícone e rótulo certos", () => {
    const lines = formatProjectChecklist({ architect: "ready", designer: "running", frontend: "done", backend: "failed" });
    assert.deepEqual(lines, ["○ Arquiteta (na fila)", "◐ Designer (rodando)", "✓ Frontend (concluído)", "✗ Backend (falhou)"]);
});

test("formatProjectSummary: conta done E failed como terminados", () => {
    assert.equal(formatProjectSummary({ frontend: "done", backend: "failed", dba: "running" }), "2 de 3 terminados");
});

test("formatProjectSummary: nenhum step terminado ainda", () => {
    assert.equal(formatProjectSummary({ frontend: "ready" }), "0 de 1 terminados");
});

test("formatProjectChecklist: papel DINÂMICO (não um dos clássicos) aparece capitalizado, depois dos clássicos", () => {
    const lines = formatProjectChecklist({ frontend: "done", mobile: "running" });
    assert.deepEqual(lines, ["✓ Frontend (concluído)", "◐ Mobile (rodando)"]);
});

test("formatProjectChecklist: só papéis dinâmicos, sem nenhum clássico presente", () => {
    const lines = formatProjectChecklist({ infra: "ready" });
    assert.deepEqual(lines, ["○ Infra (na fila)"]);
});
