/**
 * Contratos conceituais compartilhados entre CloudDocumentExecutor e
 * LocalDocumentExecutor. Este arquivo é intencionalmente livre de Nest, Genkit,
 * Node e bibliotecas de terceiros: ele descreve apenas a superfície de
 * operações, para que backend, client e web possam conversar sobre documentos
 * sem conhecer as bibliotecas internas de cada executor.
 *
 * Regras destes contratos:
 * - O modelo nunca fornece caminhos de filesystem, apenas IDs lógicos.
 * - `executor` é uma preferência, nunca uma autorização: a autorização é
 *   sempre decidida pelo orquestrador (backend) com base no tenant/sessão.
 * - Nenhuma operação aqui concede acesso a arquivos pessoais.
 */

export type DocumentFormat = "docx" | "xlsx" | "pptx" | "pdf" | "csv" | "txt";

export type ExecutorKind = "cloud" | "local";
export type ExecutorPreference = ExecutorKind | "auto";

export type DocumentWorkspaceKind = "cloud" | "local";

export type DocumentStatus = "available" | "processing" | "failed" | "deleted";

export type PreviewFidelity = "exact" | "structural" | "partial" | "unavailable";

export interface DocumentIdentity {
  /** ID lógico estável, opaco para o modelo. Nunca um caminho. */
  id: string;
  /** ID do workspace ao qual o documento pertence. */
  workspaceId: string;
  format: DocumentFormat;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Revisão monotônica; usada para concorrência otimista. */
  revision: number;
  status: DocumentStatus;
  executor: ExecutorKind;
  createdAt: string;
  updatedAt: string;
  preview?: DocumentPreviewInfo;
  /** Metadados específicos de formato (contagem de slides, abas, páginas...). */
  meta?: Record<string, unknown>;
}

export interface DocumentPreviewInfo {
  available: boolean;
  fidelity: PreviewFidelity;
  mimeType?: string;
  /** Quantidade de páginas/slides/abas quando conhecida. */
  pageCount?: number;
  note?: string;
}

export interface DocumentResult {
  document: DocumentIdentity;
  /** Texto curto, semântico, seguro para o modelo — nunca bytes nem paths. */
  summary: string;
  warnings?: string[];
}

export interface DocumentCapabilities {
  format: DocumentFormat;
  operations: string[];
  /** Capacidades explicitamente indisponíveis, com motivo. */
  limitations: Array<{ operation: string; reason: string }>;
}

/* -------------------------------------------------------------------------- */
/* DOCX                                                                        */
/* -------------------------------------------------------------------------- */

export interface DocxBlock {
  type: "heading" | "paragraph" | "bullet" | "numbered" | "quote" | "pageBreak";
  text?: string;
  level?: number;
  style?: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
  align?: "left" | "center" | "right" | "justify";
}

export interface DocxTableSpec {
  rows: string[][];
  headerRow?: boolean;
  widths?: number[];
  border?: boolean;
  shading?: string[];
  /** Mesclagem e estilo por célula, na mesma posição de `rows`. */
  spans?: Array<Array<{ colSpan?: number; rowSpan?: number; bold?: boolean; shading?: string }>>;
}

export interface DocxImageSpec {
  /** Base64 puro, sem prefixo data:. */
  base64: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif";
  width?: number;
  height?: number;
  /** Legenda opcional inserida como parágrafo. */
  caption?: string;
}

export interface DocxSectionSpec {
  margins?: { top?: number; bottom?: number; left?: number; right?: number };
  orientation?: "portrait" | "landscape";
  header?: string;
  footer?: string;
}

export interface CreateDocumentInput {
  format: "docx";
  workspaceId: string;
  filename: string;
  title?: string;
  blocks?: DocxBlock[];
  table?: DocxTableSpec;
  image?: DocxImageSpec;
  section?: DocxSectionSpec;
  /** Sumário automático (campo Word atualizável pelo aplicativo). */
  tableOfContents?: boolean;
  executor?: ExecutorPreference;
  /** Conteúdo de texto simples para criação rápida. */
  content?: string;
}

/** Edita um DOCX existente preservando as partes não tocadas do pacote OOXML. */
export interface EditDocumentInput {
  documentId: string;
  expectedRevision?: number;
  executor?: ExecutorPreference;
  operations: DocxOperation[];
}

/**
 * Importa um artefato já existente (upload autorizado) para dentro do
 * workspace. Nenhum path de filesystem cruza esta fronteira — apenas bytes,
 * nome de exibição e formato lógico.
 */
export interface ImportDocumentInput {
  workspaceId: string;
  filename: string;
  format: DocumentFormat;
  bytes: Buffer | Uint8Array;
  executor?: ExecutorPreference;
}

export type DocxOperation =
  | { op: "replaceText"; find: string; replace: string }
  | { op: "insertParagraph"; afterText?: string; text: string; style?: string; align?: DocxBlock["align"] }
  | { op: "setStyle"; find: string; style: string }
  | { op: "setAlignment"; find: string; align: NonNullable<DocxBlock["align"]> }
  | { op: "setFont"; find: string; font?: string; size?: number; color?: string; bold?: boolean; italic?: boolean }
  | { op: "insertTable"; afterText?: string; table: DocxTableSpec }
  | { op: "insertImage"; afterText?: string; image: DocxImageSpec }
  | { op: "pageBreak"; afterText?: string }
  | { op: "setHeader"; text: string }
  | { op: "setFooter"; text: string }
  | { op: "setSection"; section: DocxSectionSpec };

/* -------------------------------------------------------------------------- */
/* XLSX                                                                        */
/* -------------------------------------------------------------------------- */

export type CellValue = string | number | boolean | null;

export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  fontColor?: string;
  fill?: string;
  numFmt?: string;
  align?: "left" | "center" | "right";
  border?: boolean;
}

export interface SheetCell {
  /** Endereço A1, ex.: "B3". */
  ref: string;
  /** Use `formula` (sem '=') para fórmulas; `value` para valores literais. */
  value?: CellValue;
  formula?: string;
  format?: CellFormat;
}

export interface SheetTableSpec {
  name: string;
  ref: string;
  style?: string;
}

export interface SheetConditionalFormat {
  ref: string;
  type: "cellIs" | "containsText" | "top10" | "colorScale";
  operator?: "greaterThan" | "lessThan" | "equal" | "notEqual" | "greaterThanOrEqual" | "lessThanOrEqual";
  formula?: string[];
  color?: string;
}

export interface SheetDataValidation {
  ref: string;
  type: "list" | "whole" | "decimal";
  values?: string[];
  operator?: "between" | "greaterThan" | "lessThan";
  formula1?: string;
  formula2?: string;
}

export interface ChartSeriesSpec {
  title: string;
  /** Intervalo de categorias, ex.: "A2:A8" ou "Vendas!A2:A8". */
  categories?: string;
  /** Intervalo de valores, ex.: "B2:B8". */
  values: string;
  /** Intervalo de X para dispersão, ex.: "A2:A8". */
  xValues?: string;
}

export type NativeChartType =
  | "column"
  | "bar"
  | "line"
  | "pie"
  | "doughnut"
  | "area"
  | "scatter"
  | "columnStacked"
  | "barStacked"
  | "combo";

export interface ChartSpec {
  id: string;
  type: NativeChartType;
  title?: string;
  sheet: string;
  series: ChartSeriesSpec[];
  /** Célula inicial de ancoragem, ex.: "D2". */
  anchor?: string;
  width?: number;
  height?: number;
  legend?: boolean;
  /** Para `combo`: tipo por série, na mesma ordem de `series`. */
  seriesTypes?: Array<"column" | "line" | "area">;
}

export interface SheetSpec {
  name: string;
  cells?: SheetCell[];
  /** Linhas tabulares simples (primeira linha = cabeçalho). */
  rows?: CellValue[][];
  columns?: Array<{ header: string; key: string; width?: number }>;
  records?: Array<Record<string, CellValue>>;
  merges?: string[];
  freeze?: string;
  autoFilter?: string;
  tables?: SheetTableSpec[];
  conditionalFormats?: SheetConditionalFormat[];
  dataValidations?: SheetDataValidation[];
  widths?: Array<{ column: string; width: number }>;
}

export interface CreateSpreadsheetInput {
  format: "xlsx";
  workspaceId: string;
  filename: string;
  sheets: SheetSpec[];
  charts?: ChartSpec[];
  executor?: ExecutorPreference;
}

export interface EditSpreadsheetInput {
  documentId: string;
  expectedRevision?: number;
  executor?: ExecutorPreference;
  operations: SpreadsheetOperation[];
}

export type SpreadsheetOperation =
  | { op: "setCells"; sheet: string; cells: SheetCell[] }
  | { op: "appendRows"; sheet: string; rows: CellValue[][] }
  | { op: "addSheet"; sheet: SheetSpec }
  | { op: "renameSheet"; from: string; to: string }
  | { op: "deleteSheet"; sheet: string }
  | { op: "formatRange"; sheet: string; ref: string; format: CellFormat }
  | { op: "mergeCells"; sheet: string; ref: string }
  | { op: "unmergeCells"; sheet: string; ref: string }
  | { op: "freeze"; sheet: string; ref: string }
  | { op: "autoFilter"; sheet: string; ref: string }
  | { op: "addTable"; sheet: string; table: SheetTableSpec }
  | { op: "addConditionalFormat"; sheet: string; rule: SheetConditionalFormat }
  | { op: "addDataValidation"; sheet: string; rule: SheetDataValidation }
  | { op: "addChart"; chart: ChartSpec }
  | { op: "removeChart"; chartId: string }
  | { op: "setWidth"; sheet: string; column: string; width: number };

/* -------------------------------------------------------------------------- */
/* PPTX / PDF                                                                   */
/* -------------------------------------------------------------------------- */

export interface SlideInfo {
  index: number;
  title?: string;
  texts: string[];
  imageCount: number;
  tableCount: number;
  chartCount: number;
  notes?: string;
}

export interface InspectPresentationResult {
  slideCount: number;
  width?: number;
  height?: number;
  slides: SlideInfo[];
  previewFidelity: PreviewFidelity;
  previewNote?: string;
}

export interface InspectPdfResult {
  pageCount: number;
  textChars: number;
  hasSelectableText: boolean;
  title?: string;
}

/* -------------------------------------------------------------------------- */
/* DocumentEngine                                                              */
/* -------------------------------------------------------------------------- */

/** Superfície comum implementada por CloudDocumentExecutor e LocalDocumentExecutor. */
export interface DocumentEngine {
  create(input: CreateDocumentInput | CreateSpreadsheetInput): Promise<DocumentResult>;
  import(input: ImportDocumentInput): Promise<DocumentResult>;
  inspect(documentId: string): Promise<DocumentIdentity>;
  read(documentId: string, options?: { offset?: number; limit?: number }): Promise<{ text: string; truncated: boolean }>;
  edit(input: EditDocumentInput | EditSpreadsheetInput): Promise<DocumentResult>;
  render(documentId: string): Promise<{ mimeType: string; bytes: Buffer | Uint8Array; fidelity: PreviewFidelity }>;
  export(documentId: string, format: DocumentFormat): Promise<DocumentResult>;
  capabilities(): Promise<DocumentCapabilities[]>;
}

export const DOCUMENT_OPERATIONS = {
  docx: ["create", "inspect", "read", "replaceText", "insertParagraph", "setStyle", "setAlignment", "setFont", "insertTable", "insertImage", "pageBreak", "setHeader", "setFooter", "setSection", "render", "export"],
  xlsx: ["create", "inspect", "read", "setCells", "appendRows", "addSheet", "renameSheet", "deleteSheet", "formatRange", "mergeCells", "freeze", "autoFilter", "addTable", "addConditionalFormat", "addDataValidation", "addChart", "removeChart", "setWidth", "render", "export"],
  pptx: ["inspect", "read", "render", "export"],
  pdf: ["inspect", "read", "render", "export"],
  csv: ["create", "inspect", "read", "export"],
  txt: ["create", "inspect", "read", "export"],
} as const;
