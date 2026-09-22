import assert from "node:assert/strict";
import test from "node:test";
import { actionIndexOfRow, actionRows, buildChannelRows, rowIndexOfAction, validateBotToken, validateOwnerId } from "./channels-model.ts";

const ids = (rows: ReturnType<typeof buildChannelRows>) => actionRows(rows).map((r) => r.id);

test("WhatsApp: a ação certa para cada estado (desconectado → conectar; conectando/qr → cancelar; conectado → desconectar; erro → apagar e gerar QR)", () => {
    assert.ok(ids(buildChannelRows({ whatsapp: { status: "disconnected" } })).includes("wa-connect"));
    assert.ok(ids(buildChannelRows({ whatsapp: { status: "connecting" } })).includes("wa-cancel"));
    assert.ok(ids(buildChannelRows({ whatsapp: { status: "qr" } })).includes("wa-cancel"));
    const connected = ids(buildChannelRows({ whatsapp: { status: "connected" } }));
    assert.ok(connected.includes("wa-logout"));
    assert.ok(!connected.includes("wa-connect"));
    const errored = ids(buildChannelRows({ whatsapp: { status: "error", error: "x" } }));
    assert.ok(errored.includes("wa-reset"), "erro exige apagar a sessão antes de um QR novo — nunca some direto sem confirmação (ver wa-logout)");
    assert.ok(!errored.includes("wa-connect"), "não pode reconectar direto num estado que já sabemos inválido");
});

test("WhatsApp em erro mostra o texto do erro em destaque; a ação de reconectar é DANGER (apaga a sessão local, mesma gravidade de wa-logout — pede confirmação)", () => {
    const rows = buildChannelRows({ whatsapp: { status: "error", error: "sessão desconectada (logout)" } });
    assert.ok(rows.some((r) => r.kind === "info" && r.tone === "danger" && r.text.includes("logout")));
    const reset = actionRows(rows).find((r) => r.id === "wa-reset")!;
    assert.equal(reset.danger, true);
});

test("Telegram: sem token só oferece definir; com token oferece trocar, reconectar e remover; ID do dono sempre", () => {
    assert.deepEqual(ids(buildChannelRows({ telegramTokenSet: false })).filter((id) => id.startsWith("tg-")), ["tg-token", "tg-owner"]);
    assert.deepEqual(ids(buildChannelRows({ telegramTokenSet: true })).filter((id) => id.startsWith("tg-")), ["tg-token", "tg-reconnect", "tg-remove", "tg-owner"]);
    assert.equal(actionRows(buildChannelRows({ telegramTokenSet: undefined })).find((r) => r.id === "tg-token")!.hint, "…", "consultando o daemon");
});

test("donos: dica mostra o valor atual ou 'não definido'; ações destrutivas são marcadas como danger", () => {
    const rows = actionRows(buildChannelRows({ whatsappOwner: "5511999998888", telegramOwner: undefined, telegramTokenSet: true, whatsapp: { status: "connected" } }));
    assert.equal(rows.find((r) => r.id === "wa-owner")!.hint, "5511999998888");
    assert.equal(rows.find((r) => r.id === "tg-owner")!.hint, "não definido");
    assert.deepEqual(rows.filter((r) => r.danger).map((r) => r.id), ["wa-logout", "tg-remove"]); // esta fixture não está em "error"; ver o teste dedicado de wa-reset acima
});

test("mapeamento linha ↔ ação é consistente (base do clique do mouse)", () => {
    const rows = buildChannelRows({ whatsapp: { status: "error", error: "e" }, telegramTokenSet: true });
    const actions = actionRows(rows);
    actions.forEach((action, index) => {
        const rowIndex = rowIndexOfAction(rows, index);
        assert.equal((rows[rowIndex] as { id?: string }).id, action.id);
        assert.equal(actionIndexOfRow(rows, rowIndex), index);
    });
    assert.equal(actionIndexOfRow(rows, 0), -1, "cabeçalho não é ação");
    assert.ok(rows.some((r) => r.kind === "spacer"), "seções separadas por linha em branco explícita (1 linha = 1 posição)");
    assert.equal(actionIndexOfRow(rows, 999), -1);
    assert.equal(rowIndexOfAction(rows, 99), -1);
});

test("validateOwnerId: só dígitos e tamanho plausível, com mensagem por canal", () => {
    assert.deepEqual(validateOwnerId("whatsapp", "+55 (11) 99999-8888"), { ok: true, value: "5511999998888" });
    assert.equal(validateOwnerId("whatsapp", "123").ok, false);
    assert.equal(validateOwnerId("whatsapp", "").ok, false);
    assert.deepEqual(validateOwnerId("telegram", " 123456789 "), { ok: true, value: "123456789" });
    assert.equal(validateOwnerId("telegram", "12").ok, false);
    assert.match((validateOwnerId("telegram", "abc") as { error: string }).error, /ID numérico/);
});

test("validateBotToken: aceita o formato do BotFather, recusa o resto sem ecoar o valor", () => {
    assert.equal(validateBotToken("123456789:AAEhBOweik6ad7C_ZkJIIUexampleexample1").ok, true);
    for (const bad of ["", "   ", "abc", "123:curto", "sem-dois-pontos-aqui-mesmo-1234567890"]) {
        const result = validateBotToken(bad);
        assert.equal(result.ok, false);
        assert.ok(!(result as { error: string }).error.includes(bad.trim() || "\u0000"), "a mensagem de erro não pode repetir o que foi digitado (pode ser um segredo)");
    }
});
