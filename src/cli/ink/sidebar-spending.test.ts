import { test } from "node:test";
import assert from "node:assert/strict";
import { spendingLines } from "./sidebar-spending.ts";

const msg = (at: string, costBrl: number | null) => ({ at, sessionId: "s1", inputTokens: 30_000, cachedTokens: 20_000, outputTokens: 120, thoughtsTokens: 40, costBrl });

test("mostra saldo, última, sessão, hoje e o histórico por mensagem (mais recente primeiro)", () => {
    const lines = spendingLines({ balanceBrl: 12.5, lastCostBrl: 0.0612, sessionCostBrl: 0.18, todayCostBrl: 0.5, messages: [msg("2026-09-24T17:32:00Z", 0.0612), msg("2026-09-24T17:30:00Z", null)] }, 27, 20).map((l) => l.text);
    assert.equal(lines[0], "Gastos");
    assert.match(lines[1]!, /^Saldo\s+R\$ 12,50$/);
    assert.match(lines[2]!, /^Última msg\s+R\$ 0,0612$/);
    assert.match(lines[3]!, /^Sessão\s+R\$ 0,18$/);
    assert.match(lines[4]!, /^Hoje\s+R\$ 0,50$/);
    assert.match(lines[6]!, /^14:32 30k\s+R\$ 0,0612$/);
    assert.match(lines[7]!, /^14:30 30k\s+—$/); // linha antiga, sem custo registrado
});

test("NUNCA passa de maxRows nem de width (sidebar de altura fixa)", () => {
    const many = Array.from({ length: 50 }, (_, i) => msg(`2026-09-24T1${i % 10}:00:00Z`, 0.05));
    for (const rows of [0, 1, 3, 6, 9]) {
        const lines = spendingLines({ balanceBrl: 1234567.89, messages: many }, 27, rows);
        assert.ok(lines.length <= rows, `rows=${rows} → ${lines.length}`);
        for (const l of lines) assert.ok(l.text.length <= 27, l.text);
    }
});

test("saldo zerado/negativo sai em destaque de aviso", () => {
    const [, saldo] = spendingLines({ balanceBrl: -0.02, messages: [] }, 27, 10);
    assert.equal(saldo!.tone, "warning");
});
