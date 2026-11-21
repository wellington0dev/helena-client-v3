/**
 * Engine DOCX: criação rica com `docx` e leitura/prévia com `mammoth`.
 * A edição preservadora vive em `docx-edit.ts` e atua diretamente no ZIP,
 * sem reconstruir o documento.
 */
import mammoth from "mammoth";
import {
  AlignmentType,
  BorderStyle,
  Document,
  FileChild,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageBreak,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
} from "docx";
import type { CreateDocumentInput, DocxBlock, DocxTableSpec, PreviewFidelity } from "./contracts.ts";
import { DOCUMENT_MIME_TYPES } from "../data-files-adapter.ts";

const ALIGNMENT: Record<NonNullable<DocxBlock["align"]>, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

function headingLevel(level: number | undefined): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  const normalized = Math.min(4, Math.max(1, level ?? 1));
  return normalized === 1
    ? HeadingLevel.HEADING_1
    : normalized === 2
      ? HeadingLevel.HEADING_2
      : normalized === 3
        ? HeadingLevel.HEADING_3
        : HeadingLevel.HEADING_4;
}

function textRun(block: DocxBlock): TextRun {
  return new TextRun({
    text: block.text ?? "",
    bold: block.bold,
    italics: block.italic,
    color: block.color?.replace(/^#/, ""),
    size: block.size ? Math.round(block.size * 2) : undefined,
  });
}

function paragraphFromBlock(block: DocxBlock): Paragraph {
  const children = block.type === "quote"
    ? [new TextRun({ text: block.text ?? "", italics: true })]
    : [textRun(block)];
  // IParagraphOptions tem campos readonly: todas as opções são passadas no
  // construtor, nunca atribuídas depois.
  const options: IParagraphOptions = {
    children,
    alignment: block.align ? ALIGNMENT[block.align] : undefined,
    spacing: { after: 120 },
    style: block.style,
    heading: block.type === "heading" ? headingLevel(block.level) : undefined,
    bullet: block.type === "bullet" ? { level: Math.max(0, (block.level ?? 1) - 1) } : undefined,
    numbering: block.type === "numbered" ? { reference: "numbered-list", level: Math.max(0, (block.level ?? 1) - 1) } : undefined,
    indent: block.type === "quote" ? { left: 480 } : undefined,
    border: block.type === "quote" ? { left: { style: BorderStyle.SINGLE, size: 12, color: "999999" } } : undefined,
  };
  return new Paragraph(options);
}

/** Converte texto simples (títulos `#`, listas `-`/`1.`) em blocos tipados. */
export function parseSimpleContent(content: string): DocxBlock[] {
  return content.split(/\r?\n/).filter((line) => line.trim() !== "").map((line) => {
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) return { type: "heading", text: heading[2], level: heading[1]!.length } satisfies DocxBlock;
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    if (bullet) return { type: "bullet", text: bullet[1], level: 1 } satisfies DocxBlock;
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (numbered) return { type: "numbered", text: numbered[1], level: 1 } satisfies DocxBlock;
    return { type: "paragraph", text: line.trim() } satisfies DocxBlock;
  });
}

function tableFromSpec(spec: DocxTableSpec): Table {
  const rows = spec.rows.map((cells, rowIndex) =>
    new TableRow({
      tableHeader: spec.headerRow && rowIndex === 0,
      children: cells.map((value, columnIndex) => {
        const meta = spec.spans?.[rowIndex]?.[columnIndex];
        return new TableCell({
          columnSpan: meta?.colSpan,
          rowSpan: meta?.rowSpan,
          width: spec.widths?.[columnIndex] ? { size: spec.widths[columnIndex], type: WidthType.PERCENTAGE } : undefined,
          shading: meta?.shading ?? spec.shading?.[rowIndex % spec.shading.length] ? {
            type: "clear",
            color: (meta?.shading ?? spec.shading?.[rowIndex % spec.shading.length])!.replace(/^#/, ""),
          } : undefined,
          borders: spec.border === false ? undefined : {
            top: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" },
            left: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" },
            right: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" },
          },
          children: [
            new Paragraph({
              children: [new TextRun({ text: value, bold: meta?.bold || (spec.headerRow && rowIndex === 0) })],
            }),
          ],
        });
      }),
    }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function decodeBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("Imagem inválida: base64 malformado.");
  }
  return Buffer.from(value, "base64");
}

export async function createDocx(input: CreateDocumentInput): Promise<Buffer> {
  const children: FileChild[] = [];
  if (input.title) {
    children.push(new Paragraph({ text: input.title, heading: HeadingLevel.TITLE, spacing: { after: 320 } }));
  }
  if (input.tableOfContents) {
    children.push(new TableOfContents("Sumário", { hyperlink: true, headingStyleRange: "1-3" }));
    children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  for (const block of input.blocks ?? parseSimpleContent(input.content ?? "")) {
    if (block.type === "pageBreak") children.push(new Paragraph({ children: [new PageBreak()] }));
    else children.push(paragraphFromBlock(block));
  }
  if (input.table) children.push(tableFromSpec(input.table));
  if (input.image) {
    const data = decodeBase64(input.image.base64);
    children.push(
      new Paragraph({
        children: [
          new ImageRun({
            type: input.image.mimeType === "image/png" ? "png" : input.image.mimeType === "image/gif" ? "gif" : "jpg",
            data,
            transformation: { width: input.image.width ?? 480, height: input.image.height ?? 320 },
            altText: { title: "Imagem", description: input.image.caption ?? "Imagem inserida", name: "imagem" },
          }),
        ],
        alignment: AlignmentType.CENTER,
      }),
    );
    if (input.image.caption) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: input.image.caption, italics: true })],
          alignment: AlignmentType.CENTER,
        }),
      );
    }
  }

  const margins = input.section?.margins;
  const section = {
    properties: {
      page: {
        margin: margins
          ? {
              top: margins.top ?? 1440,
              bottom: margins.bottom ?? 1440,
              left: margins.left ?? 1440,
              right: margins.right ?? 1440,
            }
          : undefined,
        orientation: input.section?.orientation === "landscape" ? "landscape" as const : undefined,
      },
    },
    headers: input.section?.header
      ? { default: new Header({ children: [new Paragraph({ text: input.section.header, alignment: AlignmentType.RIGHT })] }) }
      : undefined,
    footers: input.section?.footer
      ? { default: new Footer({ children: [new Paragraph({ text: input.section.footer, alignment: AlignmentType.CENTER })] }) }
      : undefined,
    children,
  };
  return Packer.toBuffer(new Document({ sections: [section] }));
}

export interface DocxInspection {
  paragraphCount: number;
  tableCount: number;
  imageCount: number;
  hasHeaders: boolean;
  hasFooters: boolean;
  textChars: number;
}

export function inspectDocx(documentXml: string, entries: Iterable<string>): DocxInspection {
  const names = [...entries];
  return {
    paragraphCount: (documentXml.match(/<w:p[ >]/g) ?? []).length,
    tableCount: (documentXml.match(/<w:tbl[ >]/g) ?? []).length,
    imageCount: names.filter((name) => name.startsWith("word/media/")).length,
    hasHeaders: names.some((name) => /^word\/header\d+\.xml$/.test(name)),
    hasFooters: names.some((name) => /^word\/footer\d+\.xml$/.test(name)),
    textChars: (documentXml.match(/<w:t[ >][\s\S]*?<\/w:t>/g) ?? [])
      .map((tag) => tag.replace(/<[^>]+>/g, ""))
      .join("").length,
  };
}

/** Texto completo (sem limite de página) para leitura dirigida pelo agente. */
export async function readDocxText(bytes: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer: bytes });
  return result.value;
}

/** HTML estrutural para prévia. Mammoth não preserva paginação/fidelidade visual. */
export async function renderDocxHtml(bytes: Buffer): Promise<{ html: string; fidelity: PreviewFidelity; note: string }> {
  const result = await mammoth.convertToHtml({ buffer: bytes }, { styleMap: [] });
  return {
    html: result.value,
    fidelity: "structural",
    note: "Prévia estrutural gerada por Mammoth; paginação e alguns estilos visuais podem diferir do Word.",
  };
}

export const DOCX_MIME_TYPE = DOCUMENT_MIME_TYPES.docx;
