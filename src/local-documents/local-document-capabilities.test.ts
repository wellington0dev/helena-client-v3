import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-doc-caps-"));
process.env.HOME = fakeHome;
process.env.HELENA_CONFIG_DIR = fakeHome;

const { dispatchDocumentCapability: dispatch, DOCUMENT_WORKSPACE_CAPABILITIES } = await import("./local-document-capabilities.ts");
const { LocalDocumentWorkspace: WorkspaceClass } = await import("./local-document-workspace.ts");
const { DOCX_MIME_TYPE, XLSX_MIME_TYPE } = await import("./data-files-adapter.ts");

const workspace = new WorkspaceClass({ root: path.join(fakeHome, "docs"), baseUrl: "http://127.0.0.1:4100" });

async function call(capability: string, payload: Record<string, unknown> = {}) {
    return (await dispatch(capability, payload, workspace)) as Record<string, any>;
}

test("capabilities declaradas e despacho desconhecido falha fechado", async () => {
    assert.equal(DOCUMENT_WORKSPACE_CAPABILITIES.length, 12);
    const unknown = await call("document_workspace_inexistente");
    assert.equal(unknown.ok, false);
    assert.match(unknown.error, /desconhecida/);
});

test("ciclo create → inspect → read → edit → render → download → remove", async () => {
    const created = await call("document_workspace_create", {
        format: "docx",
        filename: "capability.docx",
        content: "texto original",
        workspaceId: "contratos",
    });
    assert.equal(created.ok, true);
    assert.equal(created.document.executor, "local");
    assert.equal(created.document.workspaceId, "local:contratos");
    const id = created.documentId as string;

    const listed = await call("document_workspace_list", { workspaceId: "contratos" });
    assert.equal(listed.documents.length, 1);
    const other = await call("document_workspace_list", { workspaceId: "outro" });
    assert.equal(other.documents.length, 0);

    const inspected = await call("document_workspace_inspect", { documentId: id, workspaceId: "contratos" });
    assert.equal(inspected.document.revision, 1);
    const crossed = await call("document_workspace_inspect", { documentId: id, workspaceId: "outro" });
    assert.equal(crossed.ok, false, "capability atravessou workspace");
    assert.equal(crossed.code, "NOT_FOUND");

    const read = await call("document_workspace_read", { documentId: id, workspaceId: "contratos" });
    assert.match(read.text, /texto original/);

    const rendered = await call("document_workspace_render", { documentId: id, workspaceId: "contratos" });
    assert.equal(rendered.fidelity, "structural");
    assert.match(rendered.previewUrl, /token=[0-9a-f]{48}$/);

    const downloaded = await call("document_workspace_download", { documentId: id, workspaceId: "contratos" });
    assert.equal(Buffer.from(downloaded.bytesBase64, "base64").subarray(0, 2).toString(), "PK");

    const preview = await call("document_workspace_preview", { documentId: id, workspaceId: "contratos" });
    assert.match(Buffer.from(preview.bytesBase64, "base64").toString(), /texto original/);

    const edited = await call("document_workspace_edit", {
        documentId: id,
        expectedRevision: 1,
        workspaceId: "contratos",
        operations: [{ op: "replaceText", find: "original", replace: "alterado" }],
    });
    assert.equal(edited.document.revision, 2);

    const conflict = await call("document_workspace_edit", {
        documentId: id,
        expectedRevision: 1,
        workspaceId: "contratos",
        operations: [{ op: "replaceText", find: "x", replace: "y" }],
    });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, "REVISION_CONFLICT");

    const caps = await call("document_workspace_capabilities");
    assert.equal(caps.capabilities.length, 6);
    assert.equal(caps.capabilities.find((c: any) => c.format === "xlsx").operations.length > 0, true);

    assert.equal((await call("document_workspace_remove", { documentId: id, workspaceId: "contratos" })).removed, true);
    assert.equal((await call("document_workspace_read", { documentId: id, workspaceId: "contratos" })).ok, false);
});

test("import por bytes base64 com limites e workspace isolado", async () => {
    const xlsx = await workspace.create({
        format: "xlsx",
        filename: "dados.xlsx",
        sheets: [{ name: "Dados", rows: [["A"], [1]] }],
    }, "origem");
    const bytes = (await workspace.bytes(xlsx.document.id, "origem")).bytes.toString("base64");
    const imported = await call("document_workspace_import", {
        filename: "importado.xlsx",
        mimeType: XLSX_MIME_TYPE,
        bytesBase64: bytes,
        workspaceId: "importados",
    });
    assert.equal(imported.ok, true);
    assert.equal(imported.document.format, "xlsx");

    const huge = await call("document_workspace_import", {
        filename: "gigante.pdf",
        mimeType: XLSX_MIME_TYPE,
        bytesBase64: Buffer.alloc(26 * 1024 * 1024).toString("base64"),
    });
    assert.equal(huge.ok, false);
    assert.equal(huge.code, "DOCUMENT_LIMIT");

    assert.equal((await call("document_workspace_inspect", { documentId: "id-que-nao-existe" })).ok, false);
    assert.equal((await call("document_workspace_create", {})).ok, false);
    assert.equal((await call("document_workspace_create", { format: "docx", filename: "ok.docx", workspaceId: "../etc" })).ok, false);
    assert.equal(DOCX_MIME_TYPE.length > 0, true);
});
