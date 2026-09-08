import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveContactIdPure } from "./whatsapp.ts";

test("resolveContactIdPure: JID normal (@s.whatsapp.net) passa direto, sem tentar resolver nada", () => {
    assert.equal(resolveContactIdPure("5521968177605@s.whatsapp.net", undefined, {}), "5521968177605@s.whatsapp.net");
});

test("resolveContactIdPure: @lid com senderPn presente sempre vence — é o dado mais fresco, mesmo com pin antigo diferente", () => {
    assert.equal(resolveContactIdPure("23115665015007@lid", "5521968177605@s.whatsapp.net", { "23115665015007@lid": "5511000000000@s.whatsapp.net" }), "5521968177605@s.whatsapp.net");
});

test("resolveContactIdPure: @lid sem senderPn, com pin conhecido, resolve pro pin", () => {
    assert.equal(resolveContactIdPure("23115665015007@lid", undefined, { "23115665015007@lid": "5521968177605@s.whatsapp.net" }), "5521968177605@s.whatsapp.net");
});

test("resolveContactIdPure: @lid sem senderPn e sem pin conhecido, devolve o próprio @lid de entrada — nunca inventa número", () => {
    assert.equal(resolveContactIdPure("99999999999999@lid", undefined, {}), "99999999999999@lid");
});
