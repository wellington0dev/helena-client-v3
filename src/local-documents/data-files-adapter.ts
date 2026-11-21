import { parse } from "csv-parse/sync";

/**
 * Adapter dos 3 imports que a engine documental faz de `backend/src/data-files/*`.
 * A engine em `local-documents/engine/` é CÓPIA exata do executor Cloud — só
 * estes símbolos mudam de origem, para que os contratos e o comportamento
 * sejam idênticos nos dois executores (Cloud e Local).
 */

export const CSV_MIME_TYPE = "text/csv";
export const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PDF_MIME_TYPE = "application/pdf";
export const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const TEXT_MIME_TYPE = "text/plain";

export const DOCUMENT_MIME_TYPES = {
    pdf: PDF_MIME_TYPE,
    docx: DOCX_MIME_TYPE,
    text: TEXT_MIME_TYPE,
    csv: CSV_MIME_TYPE,
    xlsx: XLSX_MIME_TYPE,
} as const;

export interface CsvTable {
    columns: string[];
    rows: Array<Array<string | null>>;
}

/** Espelho de `backend/src/data-files/parse-csv.ts` — mesma lib, mesmas opções. */
export function parseCsv(buffer: Buffer): CsvTable {
    const rows = parse(buffer, {
        bom: true,
        skip_empty_lines: true,
        relax_column_count: true,
    }) as string[][];
    if (rows.length === 0) throw new Error("Arquivo CSV vazio.");
    const [header, ...dataRows] = rows;
    return {
        columns: header!.map((c) => c.trim()),
        rows: dataRows.map((row) => row.map((cell) => (cell.trim() === "" ? null : cell))),
    };
}
