import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { LocalDocumentWorkspace } from "../local-documents/local-document-workspace.ts";

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-docapi-test-"));
process.env.HOME = fakeHome;
process.env.HELENA_CONFIG_DIR = fakeHome;

const { startLocalApi } = await import("./server.ts");
const { createEventHub } = await import("./event-hub.ts");
const { createSessionManager } = await import("./session-manager.ts");
const { loadOrCreateLocalToken } = await import("./local-token.ts");
const { LocalDocumentWorkspace: WorkspaceClass } = await import("../local-documents/local-document-workspace.ts");

const root = path.join(fakeHome, "documentos");
const documents = new WorkspaceClass({ root, baseUrl: "http://127.0.0.1:1" });
const hub = createEventHub();
let api: Server;
let apiUrl: string;

before(async () => {
    const session = createSessionManager({
        backendUrl: "http://127.0.0.1:1",
        store: { load: () => undefined, save: () => undefined, clear: () => undefined },
        hub,
    });
    api = startLocalApi({ port: 0, version: "test", localToken: loadOrCreateLocalToken(), session, hub, documents });
    await new Promise<void>((r) => (api.listening ? r() : api.once("listening", () => r())));
    apiUrl = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
});

after(async () => {
    api.close();
    fs.rmSync(fakeHome, { recursive: true, force: true });
});

function localUrl(original: string): string {
    const url = new URL(original);
    return `${apiUrl}${url.pathname}${url.search}`;
}

test("download por token opaco: funciona no navegador, sem Bearer, com headers de segurança", async () => {
    const created = await documents.create({ format: "docx", filename: "contrato.docx", content: "conteúdo do contrato" });
    const r = await fetch(localUrl(created.document.downloadUrl));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), created.document.mimeType);
    assert.match(r.headers.get("content-disposition") ?? "", /attachment; filename\*=UTF-8''/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
});

test("token errado, ausente ou ID inválido não revela documento", async () => {
    const created = await documents.create({ format: "docx", filename: "privado.docx", content: "segredo" });
    const url = new URL(created.document.downloadUrl);
    url.searchParams.delete("token");
    assert.equal((await fetch(localUrl(url.toString()))).status, 404);

    url.searchParams.set("token", "0".repeat(48));
    assert.equal((await fetch(localUrl(url.toString()))).status, 404);

    const missing = `${apiUrl}/v1/local-documents/00000000-0000-0000-0000-000000000000/download?token=${"0".repeat(48)}`;
    assert.equal((await fetch(missing)).status, 404);
    assert.equal((await fetch(`${apiUrl}/v1/local-documents/not-an-id/download?token=${"0".repeat(48)}`)).status, 400);
});

test("prévia por token devolve HTML estrutural; rotas /v1 continuam exigindo Bearer", async () => {
    const created = await documents.create({ format: "docx", filename: "previa.docx", content: "texto da prévia" });
    const r = await fetch(localUrl(created.document.previewUrl));
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await r.text(), /texto da prévia/);

    assert.equal((await fetch(`${apiUrl}/v1/session/status`)).status, 401);
});
