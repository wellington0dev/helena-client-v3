import { test } from "node:test";
import assert from "node:assert/strict";
import { canCancel, canDelete, canRequestRevision, canResume, orderSteps } from "./project-status.ts";
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

test("canDelete: só status terminal (completed/cancelled)", () => {
    for (const status of ALL) assert.equal(canDelete(status), status === "completed" || status === "cancelled", status);
});

function step(role: string): ProjectStep {
    return { role, status: "done" };
}

test("orderSteps: papéis clássicos na ordem fixa primeiro, dinâmicos depois na ordem em que vieram", () => {
    const steps = [step("qa"), step("um-papel-inventado"), step("architect"), step("outro-inventado"), step("frontend")];
    const ordered = orderSteps(steps).map((s) => s.role);
    assert.deepEqual(ordered, ["architect", "frontend", "qa", "um-papel-inventado", "outro-inventado"]);
});
