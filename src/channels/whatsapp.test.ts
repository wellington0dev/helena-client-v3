import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePhoneContactId, trackContactMapping } from "./whatsapp.ts";

test("resolvePhoneContactId: JID normal (@s.whatsapp.net) passa direto, sem tentar resolver nada", () => {
    assert.equal(resolvePhoneContactId("5521968177605@s.whatsapp.net"), "5521968177605@s.whatsapp.net");
});

test("resolvePhoneContactId: sem mapeamento conhecido, devolve o próprio @lid de entrada (nunca inventa número)", () => {
    assert.equal(resolvePhoneContactId("99999999999999@lid"), "99999999999999@lid");
});

test("bug real corrigido: depois de trackContactMapping aprender o par lid/jid, resolvePhoneContactId resolve o @lid pro telefone de verdade", () => {
    trackContactMapping([{ lid: "23115665015007@lid", jid: "5521968177605@s.whatsapp.net" }]);

    assert.equal(resolvePhoneContactId("23115665015007@lid"), "5521968177605@s.whatsapp.net");
});

test("trackContactMapping ignora entrada sem lid OU sem jid — nunca grava mapeamento incompleto", () => {
    trackContactMapping([{ lid: "11111111111111@lid" }, { jid: "5511999990000@s.whatsapp.net" }]);

    assert.equal(resolvePhoneContactId("11111111111111@lid"), "11111111111111@lid");
});
