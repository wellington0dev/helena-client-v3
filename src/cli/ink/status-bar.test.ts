import assert from "node:assert/strict";
import test from "node:test";
import stringWidth from "string-width";
import { statusBarParts, type StatusBarInfo } from "./status-bar.ts";

const base: StatusBarInfo = { machine: "veronica", branch: "main", dir: "~/Projects/helena", sessionId: "abcdef1234567890", tokensIn: 18400, tokensOut: 1200, turns: 3, alerts: [] };

test("statusBarParts: mostra máquina, branch, pasta, tokens acumulados e sessão quando cabe", () => {
    const { main, alert } = statusBarParts(base, 200);
    assert.equal(main, "veronica · ⎇ main · ~/Projects/helena · ↑18.4k ↓1.2k · 3 turnos · sessão abcdef12");
    assert.equal(alert, "");
});

test("statusBarParts: sem turnos não mostra tokens; singular em 1 turno", () => {
    assert.ok(!statusBarParts({ ...base, turns: 0 }, 200).main.includes("↑"));
    assert.ok(statusBarParts({ ...base, turns: 1 }, 200).main.includes("1 turno ·"));
});

test("statusBarParts: nunca passa da largura; perde segmentos do fim primeiro", () => {
    for (const width of [10, 25, 40, 60, 80]) {
        const { main, alert } = statusBarParts({ ...base, alerts: ["WhatsApp desconectado"] }, width);
        assert.ok(stringWidth(main) + stringWidth(alert) + (alert && main ? 2 : 0) <= width, `largura ${width}: "${main}" + "${alert}"`);
    }
    const narrow = statusBarParts(base, 30).main;
    assert.ok(narrow.startsWith("veronica"));
    assert.ok(!narrow.includes("sessão"));
});

test("statusBarParts: alerta tem prioridade e aparece mesmo em largura mínima", () => {
    const { alert } = statusBarParts({ ...base, alerts: ["máquina offline"] }, 24);
    assert.equal(alert, "⚠ máquina offline");
});
