/** Leitura e geração de PDF com as dependências já presentes no backend. */
import PDFDocument from "pdfkit";
import { PDFParse } from "pdf-parse";
import { PDF_MIME_TYPE } from "../data-files-adapter.ts";
import type { DocxBlock, InspectPdfResult, PreviewFidelity } from "./contracts.ts";
import { detectOfficeFormat, DocumentValidationError, escapeXml } from "./ooxml.ts";

export async function inspectPdf(bytes: Buffer): Promise<InspectPdfResult> {
  if (detectOfficeFormat(bytes) !== "pdf") {
    throw new DocumentValidationError("Arquivo não é um PDF válido (assinatura ausente).", "NOT_PDF");
  }
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const text = result.text ?? "";
    return {
      pageCount: result.total ?? result.pages?.length ?? 0,
      textChars: text.length,
      hasSelectableText: text.trim().length > 0,
    };
  } finally {
    await parser.destroy();
  }
}

export async function readPdf(bytes: Buffer, options: { offset?: number; limit?: number } = {}): Promise<{ text: string; truncated: boolean }> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    const pages = result.pages ?? [];
    const start = Math.max(0, options.offset ?? 0);
    const end = Math.min(pages.length, start + Math.min(100, Math.max(1, options.limit ?? 100)));
    const text = pages.slice(start, end).map((page) => page.text ?? "").join("\n\n");
    const normalized = text.replace(/\u0000/g, "").trim();
    return { text: normalized, truncated: end < pages.length };
  } finally {
    await parser.destroy();
  }
}

export async function createPdf(title: string, content: string, blocks?: DocxBlock[]): Promise<Buffer> {
  const document = new PDFDocument({ info: { Title: title, Producer: "Helena" }, margin: 54 });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  document.fontSize(20).text(title);
  document.moveDown();
  if (blocks?.length) {
    for (const block of blocks) {
      if (block.type === "pageBreak") { document.addPage(); continue; }
      document.fontSize(block.type === "heading" ? 14 : 11);
      document.text(block.text ?? "", { paragraphGap: 8 });
    }
  } else {
    document.fontSize(11).text(content, { lineGap: 4, paragraphGap: 8 });
  }
  document.end();
  return completed;
}

/** O PDF original já é a representação exata; a prévia visual é feita no Web. */
export function renderPdf(bytes: Buffer): { mimeType: string; bytes: Buffer; fidelity: PreviewFidelity; note: string } {
  return {
    mimeType: PDF_MIME_TYPE,
    bytes,
    fidelity: "exact",
    note: "Bytes originais do PDF; visualização em canvas PDF.js no cliente web.",
  };
}

export function pdfTextAsHtml(text: string): string {
  return text.split(/\n{2,}/).map((paragraph) => `<p>${escapeXml(paragraph)}</p>`).join("");
}
