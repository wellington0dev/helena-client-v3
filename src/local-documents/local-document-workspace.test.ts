import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LocalDocumentWorkspace } from "./local-document-workspace.ts";

// HOME/config isolados ANTES dos imports: fachada e store calculam raiz no load.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "helena-local-documents-"));
process.env.HOME = root;
process.env.HELENA_CONFIG_DIR = root;

const { LocalDocumentWorkspace: WorkspaceClass, canonicalWorkspace, formatFromMime, documentError } = await import("./local-document-workspace.ts");
const { DOCX_MIME_TYPE, XLSX_MIME_TYPE, PPTX_MIME_TYPE, PDF_MIME_TYPE } = await import("./data-files-adapter.ts");
const { sampleDocx, sampleXlsx, samplePdf, samplePptx } = await import("./engine/test-fixtures.ts");
const { DocumentValidationError } = await import("./engine/ooxml.ts");
const JSZip = (await import("jszip")).default;

function workspace(baseUrl = "http://127.0.0.1:4100"): LocalDocumentWorkspace {
    return new WorkspaceClass({ root: path.join(root, `ws-${Math.random().toString(16).slice(2)}`), baseUrl });
}

test("canonicalWorkspace: prefixo fixo local, entrada do modelo validada", () => {
    assert.equal(canonicalWorkspace(), "local:default");
    assert.equal(canonicalWorkspace("projetos"), "local:projetos");
    assert.throws(() => canonicalWorkspace("../etc"), /workspaceId inválido/);
    assert.equal(formatFromMime(DOCX_MIME_TYPE), "docx");
    assert.equal(formatFromMime(PPTX_MIME_TYPE), "pptx");
    assert.throws(() => formatFromMime("application/x-something"), /Formato não suportado/);
});

test("cria DOCX real, lê, inspeciona e gera prévia estrutural", async () => {
    const ws = workspace();
    const created = await ws.create({
        format: "docx",
        filename: "relatorio",
        title: "Relatório",
        blocks: [{ type: "heading", text: "Introdução", level: 1 }, { type: "paragraph", text: "Receita de 1,2 milhões." }],
        table: { rows: [["Mês", "Receita"], ["Jan", "100"]], headerRow: true },
    });
    assert.equal(created.document.format, "docx");
    assert.equal(created.document.revision, 1);
    assert.equal(created.document.executor, "local");
    assert.ok(created.document.sizeBytes > 1000, "DOCX gerado é pequeno demais para ser real");

    const bytes = ws.byToken(created.document.id, tokenOf(created.document.downloadUrl));
    assert.ok(bytes?.bytes.subarray(0, 2).equals(Buffer.from("PK")), "não é um ZIP/OOXML real");

    const inspected = await ws.inspect(created.document.id);
    assert.equal(inspected.meta?.blockCount, 2);
    assert.equal(inspected.preview?.fidelity, "structural");

    const text = await ws.read(created.document.id);
    assert.match(text.text, /Introdução/);
    assert.match(text.text, /Receita de 1,2 milhões/);

    const rendered = await ws.render(created.document.id);
    assert.equal(rendered.mimeType, "text/html");
    assert.match(rendered.bytes.toString("utf8"), /Introdução/);
});

test("cria XLSX real com aba, fórmula e gráfico nativo editável", async () => {
    const ws = workspace();
    const created = await ws.create({
        format: "xlsx",
        filename: "vendas.xlsx",
        sheets: [
            {
                name: "Vendas",
                rows: [["Mês", "Receita"], ["Jan", 100], ["Fev", 120]],
                cells: [{ ref: "C2", formula: "B2*2" }],
            },
        ],
        charts: [{
            id: "grafico",
            type: "column",
            title: "Receita",
            sheet: "Vendas",
            series: [{ title: "Receita", categories: "Vendas!A2:A3", values: "Vendas!B2:B3" }],
            anchor: "E2",
        }],
    });
    assert.equal(created.document.meta?.sheetCount, 1);
    assert.equal(created.document.meta?.chartCount, 1, "gráfico nativo não detectado");

    const found = ws.byToken(created.document.id, tokenOf(created.document.downloadUrl));
    assert.ok(found);
    const zip = await JSZip.loadAsync(found.bytes);
    const chartParts = Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name));
    assert.equal(chartParts.length, 1, "gráfico deve ser parte OOXML, não imagem");
    const chartXml = await zip.file(chartParts[0]!)!.async("string");
    assert.match(chartXml, /<c:barChart>/, "gráfico de colunas ausente no XML");

    const rendered = await ws.render(created.document.id);
    assert.match(rendered.bytes.toString("utf8"), /Vendas/);
});

test("edição com CAS: revisão avança, token rotaciona e conflito é honesto", async () => {
    const ws = workspace();
    const created = await ws.create({ format: "docx", filename: "contrato.docx", content: "Versão original." });
    const firstToken = tokenOf(created.document.downloadUrl);

    const edited = await ws.edit({
        documentId: created.document.id,
        expectedRevision: 1,
        operations: [{ op: "replaceText", find: "original", replace: "revisada" }] as never,
    });
    assert.equal(edited.document.revision, 2);
    const secondToken = tokenOf(edited.document.downloadUrl);
    assert.notEqual(firstToken, secondToken, "token precisa rotacionar a cada revisão");
    assert.equal(ws.byToken(created.document.id, firstToken), undefined, "token antigo continua válido");
    assert.ok(ws.byToken(created.document.id, secondToken), "token novo não funciona");

    const text = await ws.read(created.document.id);
    assert.match(text.text, /revisada/);

    await assert.rejects(
        ws.edit({ documentId: created.document.id, expectedRevision: 1, operations: [{ op: "replaceText", find: "x", replace: "y" }] as never }),
        (error: unknown) => error instanceof DocumentValidationError && error.code === "REVISION_CONFLICT",
    );
    const after = await ws.inspect(created.document.id);
    assert.equal(after.revision, 2, "edição em conflito sobrescreveu a revisão");
});

test("importa PPTX e PDF reais; limites e incapacidades são explícitos", async () => {
    const ws = workspace();
    const pptx = await ws.importFile("apresentacao.pptx", PPTX_MIME_TYPE, await samplePptx());
    assert.equal(pptx.document.format, "pptx");
    assert.ok((pptx.document.meta?.slideCount as number) >= 2);
    assert.equal(pptx.document.preview?.fidelity, "structural");
    assert.match(pptx.document.preview?.note ?? "", /renderizador|Sem renderizador/i);
    await assert.rejects(
        ws.export(pptx.document.id, "pdf"),
        /LibreOffice|PPTX→PDF|PPTX para PDF/i,
    );

    const pdf = await ws.importFile("relatorio.pdf", PDF_MIME_TYPE, await samplePdf());
    assert.equal(pdf.document.format, "pdf");
    assert.equal(pdf.document.preview?.fidelity, "exact");
    const preview = await ws.previewByToken(pdf.document.id, tokenOf(pdf.document.previewUrl));
    assert.equal(preview?.mimeType, "application/pdf");
    assert.equal(preview?.bytes.subarray(0, 4).toString(), "%PDF");

    await assert.rejects(
        ws.importFile("gigante.pdf", PDF_MIME_TYPE, Buffer.alloc(26 * 1024 * 1024)),
        /grande demais/,
    );
});

test("isolamento de workspace, listagem e remoção", async () => {
    const ws = workspace();
    const privado = await ws.create({ format: "docx", filename: "privado.docx", content: "segredo" }, "projetos");
    assert.equal(privado.document.workspaceId, "local:projetos");
    assert.equal(ws.list().length, 0, "documento de outro workspace vazou na listagem padrão");
    assert.equal(ws.list("projetos").length, 1);

    await assert.rejects(
        ws.inspect(privado.document.id, "outro"),
        (error: unknown) => error instanceof DocumentValidationError && error.code === "NOT_FOUND",
    );
    assert.match(documentError(new DocumentValidationError("não encontrado", "NOT_FOUND")).code, /NOT_FOUND/);

    assert.equal(await ws.remove(privado.document.id, "projetos"), true);
    assert.equal(ws.list("projetos").length, 0);
    assert.equal(ws.byToken(privado.document.id, tokenOf(privado.document.downloadUrl)), undefined);
    assert.equal(await ws.remove(privado.document.id, "projetos"), false);
});

test("links opacos: token de 48 hex, sem path e sem JWT", async () => {
    const ws = workspace("http://127.0.0.1:9999");
    const created = await ws.create({ format: "docx", filename: "opaco.docx", content: "teste" });
    for (const url of [created.document.downloadUrl, created.document.previewUrl]) {
        assert.match(url, /^http:\/\/127\.0\.0\.1:9999\/v1\/local-documents\/[0-9a-f-]{36}\/(download|preview)\?token=[0-9a-f]{48}$/);
        const parsed = new URL(url);
        assert.ok(!/\.[a-z0-9]+$/i.test(parsed.pathname), "URL não pode conter extensão de arquivo");
        assert.ok(!parsed.pathname.includes(".."), "URL não pode conter traversão");
    }
    assert.equal(ws.byToken(created.document.id, "x".repeat(48)), undefined);
});

test("persistência: novo objeto no mesmo root encontra o documento e a revisão", async () => {
    const shared = path.join(root, "persistido");
    const first = new WorkspaceClass({ root: shared, baseUrl: "http://x" });
    const created = await first.create({ format: "docx", filename: "persistido.docx", content: "conteúdo" });
    const second = new WorkspaceClass({ root: shared, baseUrl: "http://x" });
    assert.equal((await second.inspect(created.document.id)).filename, "persistido.docx");
    assert.equal(second.list().length, 1);
    assert.ok(second.byToken(created.document.id, tokenOf(created.document.downloadUrl)));
});

function tokenOf(url: string): string {
    return new URL(url).searchParams.get("token") ?? "";
}
