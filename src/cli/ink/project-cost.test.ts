import { test } from "node:test";
import assert from "node:assert/strict";
import { sumTokensSpent } from "./project-cost.ts";
import type { ProjectStep } from "../api/projects.ts";

function step(overrides: Partial<ProjectStep> = {}): ProjectStep {
    return { role: "architect", status: "done", ...overrides };
}

test("sumTokensSpent: soma tokensSpentEstimate de todos os steps", () => {
    assert.equal(sumTokensSpent([step({ tokensSpentEstimate: 1000 }), step({ tokensSpentEstimate: 2500 })]), 3500);
});

test("sumTokensSpent: steps sem tokensSpentEstimate contam como 0, nunca NaN", () => {
    assert.equal(sumTokensSpent([step({ tokensSpentEstimate: 1000 }), step()]), 1000);
});

test("sumTokensSpent: lista vazia soma 0", () => {
    assert.equal(sumTokensSpent([]), 0);
});
