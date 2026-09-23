import assert from "node:assert/strict";
import test from "node:test";
import { redact, resetReportBudget, takeReportSlot } from "./telemetry.ts";

test("takeReportSlot: repetir a mesma mensagem seguida no mesmo nível é descartado", () => {
    resetReportBudget();
    assert.equal(takeReportSlot("error", "boom"), true);
    assert.equal(takeReportSlot("error", "boom"), false);
    assert.equal(takeReportSlot("error", "outro"), true);
});

test("takeReportSlot: teto de 20 por nível", () => {
    resetReportBudget();
    for (let i = 0; i < 20; i++) assert.equal(takeReportSlot("warn", `w${i}`), true);
    assert.equal(takeReportSlot("warn", "w-extra"), false);
});

test("takeReportSlot: warn esgotado (backend oscilando) NÃO derruba o error seguinte", () => {
    resetReportBudget();
    for (let i = 0; i < 25; i++) takeReportSlot("warn", i % 2 ? "ECONNREFUSED" : "502 Bad Gateway");
    assert.equal(takeReportSlot("error", "uncaughtException: x is undefined"), true);
});

test("takeReportSlot: mesma mensagem em níveis diferentes não se deduplica entre si", () => {
    resetReportBudget();
    assert.equal(takeReportSlot("warn", "igual"), true);
    assert.equal(takeReportSlot("error", "igual"), true);
});

test("redact: JID, e-mail, telefone, Bearer e token hex nunca saem da máquina", () => {
    const out = redact("falha 5511999998888@s.whatsapp.net grupo 120363041234567890@g.us dono@exemplo.com +55 (11) 99999-8888 Bearer abc.def-123 key=" + "a".repeat(40));
    for (const leaked of ["5511999998888", "120363041234567890", "dono@exemplo.com", "99999-8888", "abc.def-123", "a".repeat(40)]) assert.ok(!out.includes(leaked), `vazou ${leaked}: ${out}`);
    assert.ok(out.includes("<jid>") && out.includes("<email>") && out.includes("<número>") && out.includes("Bearer <token>") && out.includes("<hex>"));
});

test("redact: status HTTP, porta e números curtos passam intactos", () => {
    assert.equal(redact("backend-v2 respondeu 502 em localhost:3000 após 3 tentativas"), "backend-v2 respondeu 502 em localhost:3000 após 3 tentativas");
});
