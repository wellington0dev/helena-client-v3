import { test } from "node:test";
import assert from "node:assert/strict";
import { canCancel, canDelete, canRequestRevision, canResume, deleteConfirmText, isTerminal, orderSteps } from "./project-status.ts";
import type { ProjectStatus, ProjectStep } from "../api/projects.ts";

const ALL: ProjectStatus[] = ["draft", "planning", "active", "paused", "needs_revision", "completed", "cancelled"];

test("canRequestRevision: só quando completed", () => {
    for (const status of ALL) assert.equal(canRequestRevision(status), status === "completed", status);
});

test("canResume: só quando paused", () => {
    for (const status of ALL) assert.equal(canResume(status), status === "paused", status);
});

test("canCancel: qualquer status NÃO terminal", () => {
    for (const status of ALL) assert.equal(canCancel(status), status !== "completed" && status !== "cancelled", status);
});

test("canDelete: agora SEMPRE permitido (não terminal cancela automaticamente antes — ver deleteConfirmText)", () => {
    for (const status of ALL) assert.equal(canDelete(status), true, status);
});

test("isTerminal: só completed/cancelled", () => {
    for (const status of ALL) assert.equal(isTerminal(status), status === "completed" || status === "cancelled", status);
});

test("deleteConfirmText: terminal é só um aviso de apagar; não-terminal avisa que vai CANCELAR primeiro", () => {
    for (const status of ["completed", "cancelled"] as const) {
        const text = deleteConfirmText(status, "meu projeto");
        assert.match(text, /PERMANENTEMENTE/);
        assert.ok(!text.includes("CANCELAR"));
    }
    for (const status of ["draft", "planning", "active", "paused", "needs_revision"] as const) {
        const text = deleteConfirmText(status, "meu projeto");
        assert.match(text, /CANCELAR/);
        assert.match(text, /PERMANENTEMENTE/);
    }
});

test("deleteConfirmText: corta a descrição comprida com …", () => {
    const text = deleteConfirmText("completed", "x".repeat(100));
    assert.ok(text.includes("…"));
    assert.ok(!text.includes("x".repeat(61)));
});

function step(role: string): ProjectStep {
    return { role, status: "done" };
}

test("orderSteps: papéis clássicos na ordem fixa primeiro, dinâmicos depois na ordem em que vieram", () => {
    const steps = [step("qa"), step("um-papel-inventado"), step("architect"), step("outro-inventado"), step("frontend")];
    const ordered = orderSteps(steps).map((s) => s.role);
    assert.deepEqual(ordered, ["architect", "frontend", "qa", "um-papel-inventado", "outro-inventado"]);
});
