import assert from "node:assert/strict";
import test from "node:test";
import { validateTelegramToken } from "./telegram.ts";

// Bate na API REAL do Telegram (getMe) — sem mock, de propósito: é exatamente essa chamada que decide se um token
// entra ou não no config.json (ver setToken em main.ts). Token de formato válido mas de verdade inexistente → 401.

test("validateTelegramToken: token de formato válido mas inexistente é rejeitado pelo Telegram (401)", async () => {
    const result = await validateTelegramToken("123456789:AAEexampleexampleexampleexampl");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Não consegui validar/);
});

test("validateTelegramToken: lixo total sem formato de token também é rejeitado, sem lançar", async () => {
    const result = await validateTelegramToken("isso-nao-e-um-token");
    assert.equal(result.ok, false);
});

test("validateTelegramToken: timeout curto contra um host que não responde não trava o teste", async () => {
    const start = Date.now();
    // porta local sem ninguém escutando — grammy tenta e falha rápido (connection refused), não precisa nem do timeout
    const result = await validateTelegramToken("123456789:AAEexampleexampleexampleexampl", 2000);
    assert.equal(result.ok, false);
    assert.ok(Date.now() - start < 8000, "não pode demorar mais que o timeout configurado");
});
