/**
 * Fachada da Document Engine. Implementa a superfície comum do contrato sobre
 * um store injetado — o mesmo código serve ao executor Cloud e, com outro
 * store, ao executor Local no Client. A fachada não conhece Genkit, Nest,
 * filesystem do usuário nem paths.
 */
import { randomUUID } from "node:crypto";
import type {
  CreateDocumentInput,
  CreateSpreadsheetInput,
  DocxOperation,
  DocumentCapabilities,
  DocumentEngine,
  DocumentFormat,
  DocumentIdentity,
  DocumentResult,
  EditDocumentInput,
  EditSpreadsheetInput,
  ExecutorKind,
  ImportDocumentInput,
  PreviewFidelity,
  SpreadsheetOperation,
} from "./contracts.ts";
import { DOCUMENT_OPERATIONS } from "./contracts.ts";
import { createDocx, inspectDocx, parseSimpleContent, readDocxText, renderDocxHtml } from "./docx-engine.ts";
import { editDocx } from "./docx-edit.ts";
import { createXlsx, editXlsx, exportXlsxCsv, inspectXlsx, readXlsx, renderXlsxHtml, validateXlsx } from "./xlsx-engine.ts";
import { inspectPptx, PptxExportUnavailableError, readPptxText, renderPptxHtml } from "./pptx-engine.ts";
import { createPdf, inspectPdf, readPdf, renderPdf } from "./pdf-engine.ts";
import { DOCUMENT_MIME_TYPES as ENGINE_DOCX_MIME } from "../data-files-adapter.ts";
import { CSV_MIME_TYPE, XLSX_MIME_TYPE, PDF_MIME_TYPE } from "../data-files-adapter.ts";
import { parseCsv } from "../data-files-adapter.ts";
import { detectOfficeFormat, DocumentValidationError, loadSafeZip, readText, ZIP_PART } from "./ooxml.ts";

export interface EngineDocument {
  identity: DocumentIdentity;
  bytes: Buffer;
}

/**
 * Store mínimo e agnóstico de infraestrutura. `expectedRevision` transforma
 * `put` num compare-and-swap: duas edições concorrentes baseadas na mesma
 * revisão não podem sobrescrever uma à outra (a segunda recebe
 * REVISION_CONFLICT). Implementações persistentes DEVEM honrar isso no banco,
 * não só em memória.
 */
export interface EngineStore {
  get(id: string): Promise<EngineDocument | undefined>;
  put(document: EngineDocument, expectedRevision?: number): Promise<void>;
  delete(id: string): Promise<void>;
}

export class InMemoryEngineStore implements EngineStore {
  private readonly documents = new Map<string, EngineDocument>();
  async get(id: string): Promise<EngineDocument | undefined> { return this.documents.get(id); }
  async put(document: EngineDocument, expectedRevision?: number): Promise<void> {
    const current = this.documents.get(document.identity.id);
    if (current && expectedRevision !== undefined && current.identity.revision !== expectedRevision) {
      throw new DocumentValidationError(
        `Revisão esperada ${expectedRevision}, mas o documento está na revisão ${current.identity.revision}.`,
        "REVISION_CONFLICT",
      );
    }
    this.documents.set(document.identity.id, document);
  }
  async delete(id: string): Promise<void> { this.documents.delete(id); }
}

const MIME_BY_FORMAT: Record<DocumentFormat, string> = {
  docx: ENGINE_DOCX_MIME.docx,
  xlsx: XLSX_MIME_TYPE,
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pdf: PDF_MIME_TYPE,
  csv: CSV_MIME_TYPE,
  txt: "text/plain",
};

const EXT_BY_FORMAT: Record<DocumentFormat, string> = {
  docx: "docx", xlsx: "xlsx", pptx: "pptx", pdf: "pdf", csv: "csv", txt: "txt",
};

function now(): string { return new Date().toISOString(); }

function filenameOf(requested: string | undefined, format: DocumentFormat): string {
  const clean = (requested ?? "documento").replace(/[\\/\u0000-\u001f]/g, "").trim();
  if (!clean) return `documento.${EXT_BY_FORMAT[format]}`;
  return clean.toLowerCase().endsWith(`.${EXT_BY_FORMAT[format]}`) ? clean : `${clean}.${EXT_BY_FORMAT[format]}`;
}

function identity(params: {
  workspaceId: string; format: DocumentFormat; filename: string; bytes: Buffer; executor: ExecutorKind;
  meta?: Record<string, unknown>; preview?: DocumentIdentity["preview"];
}): DocumentIdentity {
  const timestamp = now();
  return {
    id: randomUUID(),
    workspaceId: params.workspaceId,
    format: params.format,
    filename: params.filename,
    mimeType: MIME_BY_FORMAT[params.format],
    sizeBytes: params.bytes.byteLength,
    revision: 1,
    status: "available",
    executor: params.executor,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...(params.meta && { meta: params.meta }),
    ...(params.preview && { preview: params.preview }),
  };
}

function assertRevision(current: number, expected?: number): void {
  if (expected !== undefined && current !== expected) {
    throw new DocumentValidationError(`Revisão esperada ${expected}, mas o documento está na revisão ${current}.`, "REVISION_CONFLICT");
  }
}

export class CoreDocumentEngine implements DocumentEngine {
  private readonly store: EngineStore;
  private readonly executor: ExecutorKind;
  constructor(store: EngineStore, executor: ExecutorKind = "cloud") {
    this.store = store;
    this.executor = executor;
  }

  async create(input: CreateDocumentInput | CreateSpreadsheetInput): Promise<DocumentResult> {
    if (input.format === "xlsx") {
      const result = await createXlsx(input as CreateSpreadsheetInput);
      const doc = identity({
        workspaceId: input.workspaceId,
        format: "xlsx",
        filename: filenameOf((input as CreateSpreadsheetInput).filename, "xlsx"),
        bytes: result.bytes,
        executor: this.executor,
        meta: { sheetCount: result.sheetCount, chartCount: result.chartCount },
        preview: { available: true, fidelity: "structural", pageCount: result.sheetCount },
      });
      await this.store.put({ identity: doc, bytes: result.bytes });
      return { document: doc, summary: `Planilha criada com ${result.sheetCount} aba(s) e ${result.chartCount} gráfico(s) nativo(s).` };
    }

    if (input.format !== "docx") {
      throw new DocumentValidationError(`Criação em ${(input as { format: string }).format} ainda não é suportada por esta engine. Use docx ou xlsx.`, "CAPABILITY_UNSUPPORTED");
    }
    const typed = input as CreateDocumentInput;
    const bytes = await createDocx(typed);
    const blocks = typed.blocks ?? parseSimpleContent(typed.content ?? "");
    const doc = identity({
      workspaceId: typed.workspaceId,
      format: "docx",
      filename: filenameOf(typed.filename, "docx"),
      bytes,
      executor: this.executor,
      meta: { blockCount: blocks.length, hasTable: !!typed.table, hasImage: !!typed.image },
      preview: { available: true, fidelity: "structural" },
    });
    await this.store.put({ identity: doc, bytes });
    return { document: doc, summary: `Documento Word criado com ${blocks.length} bloco(s)${typed.table ? " e uma tabela" : ""}.` };
  }

  async import(input: ImportDocumentInput): Promise<DocumentResult> {
    const bytes = Buffer.from(input.bytes);
    if (bytes.byteLength === 0) throw new DocumentValidationError("Arquivo vazio.", "BAD_ARTIFACT");
    const signature = detectOfficeFormat(bytes);
    const isOffice = input.format === "docx" || input.format === "xlsx" || input.format === "pptx";
    if (isOffice && signature !== "ooxml") throw new DocumentValidationError("A assinatura do arquivo não corresponde a um pacote OOXML.", "BAD_ARTIFACT");
    if (input.format === "pdf" && signature !== "pdf") throw new DocumentValidationError("A assinatura do arquivo não corresponde a um PDF.", "BAD_ARTIFACT");
    if ((input.format === "txt" || input.format === "csv") && bytes.includes(0)) {
      throw new DocumentValidationError("Arquivo de texto contém bytes NUL.", "BAD_ARTIFACT");
    }

    const doc = identity({
      workspaceId: input.workspaceId,
      format: input.format,
      filename: filenameOf(input.filename, input.format),
      bytes,
      executor: input.executor && input.executor !== "auto" ? input.executor : this.executor,
    });
    await this.store.put({ identity: doc, bytes });
    try {
      // A inspeção valida XML, relationships e assinatura internos. Se falhar,
      // o artefato inválido não fica órfão no workspace.
      const inspected = await this.inspect(doc.id);
      return { document: inspected, summary: `Arquivo ${input.format.toUpperCase()} importado e validado (${bytes.byteLength} bytes).` };
    } catch (error) {
      await this.store.delete(doc.id).catch(() => undefined);
      throw error;
    }
  }

  async inspect(documentId: string): Promise<DocumentIdentity> {
    const stored = await this.require(documentId);
    const { identity: doc, bytes } = stored;
    let meta: Record<string, unknown> | undefined;
    let preview: DocumentIdentity["preview"] = doc.preview;
    if (doc.format === "docx") {
      const safe = await loadSafeZip(bytes);
      meta = { ...(doc.meta ?? {}), ...inspectDocx(await readText(safe, ZIP_PART.docxDocument), safe.names) };
    } else if (doc.format === "xlsx") {
      const info = await inspectXlsx(bytes);
      meta = { ...info };
      preview = { available: true, fidelity: "structural", pageCount: info.sheetNames.length };
    } else if (doc.format === "pptx") {
      const info = await inspectPptx(bytes);
      meta = { slideCount: info.slideCount, previewFidelity: info.previewFidelity, previewNote: info.previewNote };
      preview = { available: true, fidelity: info.previewFidelity, pageCount: info.slideCount, note: info.previewNote };
    } else if (doc.format === "pdf") {
      const info = await inspectPdf(bytes);
      meta = { ...info };
      preview = { available: true, fidelity: "exact", pageCount: info.pageCount };
    }
    if (meta) {
      const updated = { ...doc, meta, preview, updatedAt: now() };
      await this.store.put({ identity: updated, bytes }, doc.revision);
      return updated;
    }
    return doc;
  }

  async read(documentId: string, options: { offset?: number; limit?: number } = {}): Promise<{ text: string; truncated: boolean }> {
    const { identity: doc, bytes } = await this.require(documentId);
    switch (doc.format) {
      case "docx": {
        const text = await readDocxText(bytes);
        return paginate(text, options);
      }
      case "xlsx": return readXlsx(bytes, options);
      case "pptx": return readPptxText(bytes, options.offset !== undefined ? options.offset + 1 : undefined);
      case "pdf": return readPdf(bytes, options);
      case "txt": return paginate(bytes.toString("utf8"), options);
      case "csv": {
        const table = parseCsv(bytes);
        const text = [table.columns.join("\t"), ...table.rows.map((row) => row.map((v) => v ?? "").join("\t"))].join("\n");
        return paginate(text, options);
      }
    }
  }

  async edit(input: EditDocumentInput | EditSpreadsheetInput): Promise<DocumentResult> {
    const current = await this.require(input.documentId);
    assertRevision(current.identity.revision, input.expectedRevision);
    if (current.identity.format === "docx") {
      const typed = input as EditDocumentInput;
      const { bytes, report } = await editDocx(current.bytes, typed.operations as DocxOperation[]);
      const final: DocumentIdentity = {
        ...current.identity,
        revision: current.identity.revision + 1,
        sizeBytes: bytes.byteLength,
        updatedAt: now(),
      };
      await this.store.put({ identity: final, bytes }, current.identity.revision);
      return {
        document: final,
        summary: `DOCX atualizado para a revisão ${final.revision}.`,
        warnings: [...report.limitations, `Operações aplicadas: ${report.applied.join(", ")}`],
      };
    }
    if (current.identity.format === "xlsx") {
      const typed = input as EditSpreadsheetInput;
      const { bytes, warnings } = await editXlsx(current.bytes, { documentId: input.documentId, operations: typed.operations as SpreadsheetOperation[] });
      await validateXlsx(bytes);
      const final: DocumentIdentity = {
        ...current.identity,
        revision: current.identity.revision + 1,
        sizeBytes: bytes.byteLength,
        updatedAt: now(),
        meta: { ...(current.identity.meta ?? {}), chartCount: (await inspectXlsx(bytes)).chartCount },
      };
      await this.store.put({ identity: final, bytes }, current.identity.revision);
      return { document: final, summary: `Planilha atualizada para a revisão ${final.revision}.`, warnings };
    }
    throw new DocumentValidationError(`Edição de ${current.identity.format} não é suportada nesta etapa.`, "CAPABILITY_UNSUPPORTED");
  }

  async render(documentId: string): Promise<{ mimeType: string; bytes: Buffer | Uint8Array; fidelity: PreviewFidelity; note?: string }> {
    const { identity: doc, bytes } = await this.require(documentId);
    switch (doc.format) {
      case "docx": {
        const preview = await renderDocxHtml(bytes);
        return { mimeType: "text/html", bytes: Buffer.from(preview.html), fidelity: preview.fidelity, note: preview.note };
      }
      case "xlsx":
        return { mimeType: "text/html", bytes: Buffer.from(await renderXlsxHtml(bytes)), fidelity: "structural", note: "Prévia tabular estrutural; gráficos nativos são exibidos pelo visualizador com os dados das células." };
      case "pptx":
        return { mimeType: "text/html", bytes: Buffer.from(await renderPptxHtml(bytes)), fidelity: "structural", note: "Sem renderizador visual; prévia mostra textos e contadores por slide." };
      case "pdf": {
        const preview = renderPdf(bytes);
        return { mimeType: preview.mimeType, bytes: preview.bytes, fidelity: preview.fidelity, note: preview.note };
      }
      default:
        return { mimeType: doc.mimeType, bytes, fidelity: "exact" };
    }
  }

  async export(documentId: string, format: DocumentFormat): Promise<DocumentResult> {
    const current = await this.require(documentId);
    if (current.identity.format === "xlsx" && format === "csv") {
      const bytes = await exportXlsxCsv(current.bytes);
      const doc = identity({ workspaceId: current.identity.workspaceId, format: "csv", filename: current.identity.filename.replace(/\.xlsx$/i, ".csv"), bytes, executor: this.executor });
      await this.store.put({ identity: doc, bytes });
      return { document: doc, summary: "Planilha exportada para CSV." };
    }
    if (current.identity.format === "csv" && format === "xlsx") {
      const table = parseCsv(current.bytes);
      const result = await createXlsx({ format: "xlsx", workspaceId: current.identity.workspaceId, filename: current.identity.filename.replace(/\.csv$/i, ".xlsx"), sheets: [{ name: "Dados", rows: [table.columns as never[], ...(table.rows as never[])] }] });
      const doc = identity({ workspaceId: current.identity.workspaceId, format: "xlsx", filename: current.identity.filename.replace(/\.csv$/i, ".xlsx"), bytes: result.bytes, executor: this.executor });
      await this.store.put({ identity: doc, bytes: result.bytes });
      return { document: doc, summary: "CSV convertido para XLSX." };
    }
    if (format === "pdf" && (current.identity.format === "docx" || current.identity.format === "txt" || current.identity.format === "csv")) {
      const content = current.identity.format === "docx" ? await readDocxText(current.bytes) : current.bytes.toString("utf8");
      const bytes = await createPdf(current.identity.filename, content);
      const doc = identity({ workspaceId: current.identity.workspaceId, format: "pdf", filename: current.identity.filename.replace(/\.[^.]+$/, ".pdf"), bytes, executor: this.executor });
      await this.store.put({ identity: doc, bytes });
      return { document: doc, summary: "Documento exportado para PDF (conversão de texto; layouts complexos podem diferir)." };
    }
    if (current.identity.format === "pptx" && format === "pdf") throw new PptxExportUnavailableError();
    throw new DocumentValidationError(`Exportação de ${current.identity.format} para ${format} não é suportada.`, "CAPABILITY_UNSUPPORTED");
  }

  async capabilities(): Promise<DocumentCapabilities[]> {
    return (Object.keys(DOCUMENT_OPERATIONS) as DocumentFormat[]).map((format) => ({
      format,
      operations: [...DOCUMENT_OPERATIONS[format]],
      limitations: format === "pptx"
        ? [
            { operation: "create", reason: "Criação/edição de PPTX não implementada nesta etapa." },
            { operation: "export:pdf", reason: "Requer LibreOffice headless, indisponível." },
            { operation: "render:exact", reason: "Sem renderizador visual; prévia é estrutural." },
          ]
        : format === "pdf"
          ? [
              { operation: "ocr", reason: "OCR é capacidade opcional separada." },
              { operation: "edit", reason: "Edição de PDF não implementada nesta etapa." },
            ]
          : format === "xlsx"
            ? [
                { operation: "chart:histogram", reason: "Tipo avançado não comprovado nesta engine." },
                { operation: "recalculate", reason: "Fórmulas são escritas sem motor de cálculo; resultados em cache não são calculados pela Helena." },
              ]
            : [],
    }));
  }

  private async require(documentId: string): Promise<EngineDocument> {
    const stored = await this.store.get(documentId);
    if (!stored) throw new DocumentValidationError(`Documento "${documentId}" não encontrado.`, "NOT_FOUND");
    if (detectOfficeFormat(stored.bytes) === "unknown" && stored.identity.format !== "txt" && stored.identity.format !== "csv") {
      throw new DocumentValidationError("Artefato corrompido ou assinatura inesperada.", "BAD_ARTIFACT");
    }
    return stored;
  }
}

function paginate(text: string, options: { offset?: number; limit?: number }): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(1000, Math.max(1, options.limit ?? 500));
  const selected = lines.slice(offset, offset + limit);
  return { text: selected.join("\n"), truncated: offset + limit < lines.length };
}
