import { test } from "node:test";
import assert from "node:assert/strict";
import { stickerMimeType, telegramDocumentMime } from "./telegram.ts";

test("telegramDocumentMime: aceita apenas extensões suportadas e MIME consistente", () => {
    assert.equal(telegramDocumentMime("contrato.pdf", "application/pdf"), "application/pdf");
    assert.equal(telegramDocumentMime("dados.csv"), "text/csv");
    assert.equal(telegramDocumentMime("contrato.pdf", "text/plain"), undefined);
    assert.equal(telegramDocumentMime("arquivo.exe", "application/octet-stream"), undefined);
});

test("stickerMimeType: figurinha estática (nenhuma flag) é webp", () => {
    assert.equal(stickerMimeType({ is_animated: false, is_video: false }), "image/webp");
});

test("stickerMimeType: figurinha animada (Lottie/TGS) tem mimetype próprio, nunca webp", () => {
    assert.equal(stickerMimeType({ is_animated: true, is_video: false }), "application/x-tgsticker");
});

test("stickerMimeType: figurinha de vídeo é webm, mesmo se is_animated também vier true", () => {
    assert.equal(stickerMimeType({ is_animated: true, is_video: true }), "video/webm");
});
