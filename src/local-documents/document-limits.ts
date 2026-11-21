import type {
  CreateDocumentInput,
  CreateSpreadsheetInput,
  DocxOperation,
  SpreadsheetOperation,
} from "./engine/contracts.ts";

/** Limites de superfície — impedem que um turno gere um artefato gigante ou milhares de operações. */
export const DOCUMENT_LIMITS = {
  importBytes: 25 * 1024 * 1024,
  textChars: 250_000,
  docxBlocks: 500,
  tableRows: 500,
  tableColumns: 40,
  sheets: 30,
  rowsPerSheet: 5_000,
  cellsPerSheet: 20_000,
  charts: 20,
  operations: 200,
  perOperationTextChars: 20_000,
  previewBytes: 12 * 1024 * 1024,
  listLimit: 100,
} as const;

export class DocumentLimitError extends Error {
    readonly code = "DOCUMENT_LIMIT";
    constructor(message: string) { super(message); this.name = "DocumentLimitError"; }
}

export function assertImportSize(bytes: number): void {
    if (!Number.isFinite(bytes) || bytes <= 0) throw new DocumentLimitError("Arquivo vazio ou com tamanho inválido.");
    if (bytes > DOCUMENT_LIMITS.importBytes) {
        throw new DocumentLimitError(`Arquivo grande demais (${bytes} bytes). Limite: ${DOCUMENT_LIMITS.importBytes} bytes.`);
    }
}

export function assertCreateLimits(input: CreateDocumentInput | CreateSpreadsheetInput): void {
    if (input.format === "xlsx") {
        const sheetInput = input as CreateSpreadsheetInput;
        if (sheetInput.sheets.length > DOCUMENT_LIMITS.sheets) throw new DocumentLimitError(`Máximo de ${DOCUMENT_LIMITS.sheets} abas.`);
        for (const sheet of sheetInput.sheets) {
            const cells = (sheet.rows?.length ?? 0) + (sheet.cells?.length ?? 0) + (sheet.records?.length ?? 0);
            if ((sheet.rows?.length ?? 0) > DOCUMENT_LIMITS.rowsPerSheet) throw new DocumentLimitError(`Aba "${sheet.name}" passa de ${DOCUMENT_LIMITS.rowsPerSheet} linhas.`);
            if (cells > DOCUMENT_LIMITS.cellsPerSheet) throw new DocumentLimitError(`Aba "${sheet.name}" passa de ${DOCUMENT_LIMITS.cellsPerSheet} células.`);
        }
        if ((sheetInput.charts?.length ?? 0) > DOCUMENT_LIMITS.charts) throw new DocumentLimitError(`Máximo de ${DOCUMENT_LIMITS.charts} gráficos.`);
        return;
    }
    const docx = input as CreateDocumentInput;
    if ((docx.blocks?.length ?? 0) > DOCUMENT_LIMITS.docxBlocks) throw new DocumentLimitError(`Máximo de ${DOCUMENT_LIMITS.docxBlocks} blocos.`);
    const rows = docx.table?.rows ?? [];
    if (rows.length > DOCUMENT_LIMITS.tableRows) throw new DocumentLimitError(`Máximo de ${DOCUMENT_LIMITS.tableRows} linhas na tabela.`);
    if (rows.some((row) => row.length > DOCUMENT_LIMITS.tableColumns)) throw new DocumentLimitError(`Máximo de ${DOCUMENT_LIMITS.tableColumns} colunas na tabela.`);
    const textLength = (docx.content?.length ?? 0) + (docx.blocks ?? []).reduce((total, block) => total + (block.text?.length ?? 0), 0);
    if (textLength > DOCUMENT_LIMITS.textChars) throw new DocumentLimitError(`Texto passa de ${DOCUMENT_LIMITS.textChars} caracteres.`);
}

export function assertEditLimits(operations: Array<DocxOperation | SpreadsheetOperation>): void {
    if (operations.length > DOCUMENT_LIMITS.operations) throw new DocumentLimitError(`Máximo de ${DOCUMENT_LIMITS.operations} operações por edição.`);
    for (const operation of operations) {
        const serialized = JSON.stringify(operation);
        if (serialized.length > DOCUMENT_LIMITS.perOperationTextChars * 4) {
            throw new DocumentLimitError("Uma operação excede o tamanho permitido.");
        }
        if (operation.op === "insertTable" && operation.table.rows.length > DOCUMENT_LIMITS.tableRows) {
            throw new DocumentLimitError(`Máximo de ${DOCUMENT_LIMITS.tableRows} linhas na tabela.`);
        }
    }
}
