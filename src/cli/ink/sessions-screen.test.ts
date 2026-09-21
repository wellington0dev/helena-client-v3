import assert from "node:assert/strict";
import test from "node:test";
import { formatWhen, historyEntriesToItems, sessionLabel } from "./sessions-screen.ts";

test("formatWhen: hoje/ontem com hora e data curta nos outros dias (fuso local)", () => {
    const now = new Date(2026, 8, 21, 15, 0);
    assert.equal(formatWhen(new Date(2026, 8, 21, 9, 5).toISOString(), now), "hoje 09:05");
    assert.equal(formatWhen(new Date(2026, 8, 20, 23, 59).toISOString(), now), "ontem 23:59");
    assert.equal(formatWhen(new Date(2026, 8, 3, 7, 0).toISOString(), now), "03/09 07:00");
    assert.equal(formatWhen("lixo", now), "");
});

test("sessionLabel: prévia vazia vira '(sem mensagens)'; longa é cortada com …", () => {
    const base = { id: "1", createdAt: "", updatedAt: "" };
    assert.equal(sessionLabel({ ...base, preview: "  " }), "(sem mensagens)");
    assert.equal(sessionLabel({ ...base, preview: "oi" }), "oi");
    assert.equal(sessionLabel({ ...base, preview: "x".repeat(200) }).length, 70);
});

test("historyEntriesToItems: só user/assistant, na ordem, sem o placeholder de resposta sem texto", () => {
    const items = historyEntriesToItems([
        { role: "user", text: "oi" },
        { role: "assistant", text: "(sem texto — a resposta só chamou uma ferramenta, sem comentário)" },
        { role: "assistant", text: "olá!" },
        { role: "system", text: "ignorado" },
    ]);
    assert.deepEqual(items.map((i) => [i.role, "text" in i ? i.text : undefined]), [["user", "oi"], ["assistant", "olá!"]]);
});
