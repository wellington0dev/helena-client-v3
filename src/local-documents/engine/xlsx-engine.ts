/**
 * Engine XLSX: workbooks reais via ExcelJS (fórmulas, estilos, abas, tabelas,
 * validação, formatação condicional) com gráficos nativos injetados em OOXML.
 */
import ExcelJS from "exceljs";
import type {
  CellFormat,
  CellValue,
  ChartSpec,
  CreateSpreadsheetInput,
  EditSpreadsheetInput,
  SheetCell,
  SheetSpec,
  SpreadsheetOperation,
} from "./contracts.ts";
import { appendChart, injectCharts, preserveCharts, removeChartById, resolveSheetPaths } from "./chart-ooxml.ts";
import { assertRelationshipsResolvable, assertWellFormed, escapeXml, loadSafeZip, putText, readText, zipBytes, type SafeZip } from "./ooxml.ts";

/**
 * O `index.d.ts` do ExcelJS declara seu próprio `interface Buffer extends
 * ArrayBuffer`, que colide com o `Buffer<ArrayBufferLike>` do Node 24 — daí a
 * incompatibilidade em `workbook.xlsx.load(bytes)`. Fazemos a conversão de
 * forma isolada e explícita, uma única vez.
 */
type ExcelLoadBuffer = Parameters<ExcelJS.Xlsx["load"]>[0];
function asExcelBuffer(bytes: Buffer): ExcelLoadBuffer {
  return bytes as unknown as ExcelLoadBuffer;
}

/** Membros existentes em runtime mas ausentes na tipagem do ExcelJS 4.4.0. */
interface WorksheetWithExtras extends ExcelJS.Worksheet {
  dataValidations: {
    add(ref: string, validation: ExcelJS.DataValidation): void;
  };
  tables: Record<string, unknown>;
}

function withExtras(worksheet: ExcelJS.Worksheet): WorksheetWithExtras {
  return worksheet as WorksheetWithExtras;
}

function columnToIndex(letters: string): number {
  return [...letters.toUpperCase()].reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
}

/** Evita que texto do modelo vire fórmula executada sem intenção explícita. */
function safeLiteral(value: CellValue): CellValue {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function argb(color: string | undefined, fallback = "FF000000"): { argb: string } {
  if (!color) return { argb: fallback };
  const clean = color.replace(/^#/, "");
  return { argb: clean.length === 6 ? `FF${clean.toUpperCase()}` : clean.toUpperCase() };
}

function applyFormat(cell: ExcelJS.Cell, format?: CellFormat): void {
  if (!format) return;
  if (format.bold || format.italic || format.fontColor || format.size) {
    cell.font = {
      bold: format.bold,
      italic: format.italic,
      color: format.fontColor ? argb(format.fontColor) : undefined,
    };
  }
  if (format.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: argb(format.fill) };
  if (format.numFmt) cell.numFmt = format.numFmt;
  if (format.align) cell.alignment = { horizontal: format.align, vertical: "middle" };
  if (format.border) {
    const side = { style: "thin" as const, color: argb("BFBFBF") };
    cell.border = { top: side, bottom: side, left: side, right: side };
  }
}

function setCell(worksheet: ExcelJS.Worksheet, spec: SheetCell): void {
  const cell = worksheet.getCell(spec.ref);
  if (spec.formula !== undefined) {
    // ExcelJS espera a fórmula sem '=' e aceita um resultado em cache opcional.
    cell.value = { formula: spec.formula.replace(/^=/, "") };
  } else {
    cell.value = safeLiteral(spec.value ?? null);
  }
  applyFormat(cell, spec.format);
}

function setFreeze(worksheet: ExcelJS.Worksheet, ref: string): void {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase() ?? "A";
  const row = Number(/\d+/.exec(ref)?.[0] ?? 1);
  let xSplit = 0;
  for (const char of letters) xSplit = xSplit * 26 + (char.charCodeAt(0) - 64);
  worksheet.views = [{ state: "frozen", xSplit: Math.max(0, xSplit - 1), ySplit: Math.max(0, row - 1), activeCell: ref }];
}

function addSheetToWorkbook(workbook: ExcelJS.Workbook, spec: SheetSpec): ExcelJS.Worksheet {
  const worksheet = workbook.addWorksheet(spec.name.slice(0, 31));
  for (const cell of spec.cells ?? []) setCell(worksheet, cell);
  if (spec.rows) spec.rows.forEach((row, index) => row.forEach((value, column) => {
    const cell = worksheet.getCell(index + 1, column + 1);
    cell.value = safeLiteral(value);
  }));
  if (spec.records && spec.columns) {
    spec.columns.forEach((column, index) => {
      worksheet.getCell(1, index + 1).value = column.header;
      worksheet.getColumn(index + 1).width = column.width ?? 18;
    });
    spec.records.forEach((record, rowIndex) => spec.columns!.forEach((column, columnIndex) => {
      worksheet.getCell(rowIndex + 2, columnIndex + 1).value = safeLiteral(record[column.key] ?? null);
    }));
  }
  for (const width of spec.widths ?? []) worksheet.getColumn(columnToIndex(width.column)).width = width.width;
  for (const merge of spec.merges ?? []) worksheet.mergeCells(merge);
  if (spec.freeze) setFreeze(worksheet, spec.freeze);
  if (spec.autoFilter) worksheet.autoFilter = spec.autoFilter;
  for (const table of spec.tables ?? []) {
    const headerRowNumber = Number(/\d+/.exec(table.ref)?.[0] ?? 1);
    const columnCount = worksheet.getRow(headerRowNumber).cellCount;
    const columns = Array.from({ length: columnCount }, (_, i) => ({ name: String(worksheet.getCell(headerRowNumber, i + 1).value ?? `Coluna ${i + 1}`) }));
    const added = worksheet.addTable({
      name: table.name.replace(/[^A-Za-z0-9_]/g, "_"),
      ref: table.ref,
      headerRow: true,
      columns,
      rows: [],
      style: { theme: (table.style ?? "TableStyleMedium2") as NonNullable<ExcelJS.TableStyleProperties["theme"]> },
    });
    added.commit();
  }
  for (const rule of spec.conditionalFormats ?? []) addConditionalFormat(worksheet, rule);
  for (const rule of spec.dataValidations ?? []) addValidation(worksheet, rule);
  return worksheet;
}

function addConditionalFormat(worksheet: ExcelJS.Worksheet, rule: import("./contracts.js").SheetConditionalFormat): void {
  if (rule.type === "colorScale") {
    worksheet.addConditionalFormatting({
      ref: rule.ref,
      rules: [{ type: "colorScale", priority: 1, cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }], color: [{ argb: "FFF8696B" }, { argb: "FFFFEB84" }, { argb: "FF63BE7B" }] }],
    });
    return;
  }
  const style = { fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: argb(rule.color ?? "FFFFC7CE") } };
  if (rule.type === "top10") {
    worksheet.addConditionalFormatting({ ref: rule.ref, rules: [{ type: "top10", priority: 1, rank: 10, percent: false, bottom: false, style }] });
    return;
  }
  if (rule.type === "containsText") {
    worksheet.addConditionalFormatting({ ref: rule.ref, rules: [{ type: "containsText", priority: 1, operator: "containsText", text: rule.formula?.[0] ?? "", style }] });
    return;
  }
  // ExcelJS escreve o operador literalmente no XML; a tipagem 4.4.0 é mais
  // restrita que o OOXML (que aceita notEqual/greaterThanOrEqual/etc.).
  const operator = (rule.operator ?? "greaterThan") as unknown as ExcelJS.CellIsOperators;
  worksheet.addConditionalFormatting({
    ref: rule.ref,
    rules: [{ type: "cellIs", priority: 1, operator, formulae: rule.formula ?? ["0"], style }],
  });
}

function addValidation(worksheet: ExcelJS.Worksheet, rule: import("./contracts.js").SheetDataValidation): void {
  if (rule.type === "list") {
    withExtras(worksheet).dataValidations.add(rule.ref, { type: "list", allowBlank: true, formulae: [`"${(rule.values ?? []).join(",")}"`] });
    return;
  }
  withExtras(worksheet).dataValidations.add(rule.ref, {
    type: rule.type,
    operator: rule.operator as ExcelJS.DataValidation["operator"],
    allowBlank: true,
    formulae: [rule.formula1 ?? "0", ...(rule.formula2 ? [rule.formula2] : [])],
  });
}

export async function createXlsx(input: CreateSpreadsheetInput): Promise<{ bytes: Buffer; sheetCount: number; chartCount: number }> {
  if (!input.sheets.length) throw new Error("Workbook sem abas.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Helena";
  workbook.created = new Date();
  for (const sheet of input.sheets) addSheetToWorkbook(workbook, sheet);
  const buffer = await workbook.xlsx.writeBuffer();
  const safe = await loadSafeZip(Buffer.from(buffer));
  await injectCharts(safe, input.charts ?? []);
  await assertRelationshipsResolvable(safe);
  return {
    bytes: await zipBytes(safe),
    sheetCount: input.sheets.length,
    chartCount: (input.charts ?? []).length,
  };
}

export interface XlsxInspection {
  sheetNames: string[];
  chartCount: number;
  tableCount: number;
  cellCount: number;
  formulaCount: number;
}

export async function inspectXlsx(bytes: Buffer): Promise<XlsxInspection> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  let cellCount = 0;
  let formulaCount = 0;
  let tableCount = 0;
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => row.eachCell((cell) => {
      cellCount += 1;
      if (typeof cell.value === "object" && cell.value && "formula" in cell.value) formulaCount += 1;
    }));
    tableCount += Object.keys(withExtras(sheet).tables).length;
  });
  const safe = await loadSafeZip(bytes);
  const chartCount = [...safe.names].filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name)).length;
  return { sheetNames: workbook.worksheets.map((sheet) => sheet.name), chartCount, tableCount, cellCount, formulaCount };
}

/** Leitura parcial e determinística: uma aba, um intervalo de linhas. */
export async function readXlsx(bytes: Buffer, options: { sheet?: string; offset?: number; limit?: number } = {}): Promise<{ text: string; truncated: boolean }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  const sheet = options.sheet ? workbook.getWorksheet(options.sheet) : workbook.worksheets[0];
  if (!sheet) throw new Error(`Aba "${options.sheet}" não encontrada.`);
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(500, Math.max(1, options.limit ?? 100));
  const lines: string[] = [];
  let emitted = 0;
  for (let rowNumber = offset + 1; rowNumber <= sheet.rowCount && emitted < limit; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: string[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const raw = cell.value;
      const value = typeof raw === "object" && raw && "formula" in raw ? `=${String((raw as { formula: string }).formula)}` : raw;
      values.push(`${column}:${String(value ?? "")}`);
    });
    lines.push(`linha ${rowNumber}: ${values.join(" | ")}`);
    emitted += 1;
  }
  return { text: lines.join("\n"), truncated: sheet.rowCount > offset + emitted };
}

function applyNonChartOperation(workbook: ExcelJS.Workbook, op: SpreadsheetOperation): void {
  if (op.op === "addChart" || op.op === "removeChart" || op.op === "addSheet") return;
  const worksheet = op.op === "renameSheet" ? workbook.getWorksheet(op.from) : "sheet" in op ? workbook.getWorksheet(op.sheet) : undefined;
  switch (op.op) {
    case "setCells":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      op.cells.forEach((cell) => setCell(worksheet!, cell));
      return;
    case "appendRows":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      for (const row of op.rows) worksheet.addRow(row.map(safeLiteral));
      return;
    case "renameSheet":
      if (!worksheet) throw new Error(`Aba "${op.from}" não encontrada.`);
      worksheet.name = op.to.slice(0, 31);
      return;
    case "deleteSheet":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      workbook.removeWorksheet(worksheet.id);
      return;
    case "formatRange":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      worksheet.getCell(op.ref); // valida referência
      for (const address of expandRange(op.ref)) applyFormat(worksheet.getCell(address), op.format);
      return;
    case "mergeCells":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      worksheet.mergeCells(op.ref);
      return;
    case "unmergeCells":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      worksheet.unMergeCells(op.ref);
      return;
    case "freeze":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      setFreeze(worksheet, op.ref);
      return;
    case "autoFilter":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      worksheet.autoFilter = op.ref;
      return;
    case "addTable": {
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      const headerRowNumber = Number(/\d+/.exec(op.table.ref)?.[0] ?? 1);
      const columns = Array.from({ length: worksheet.getRow(headerRowNumber).cellCount }, (_, i) => ({ name: String(worksheet.getCell(headerRowNumber, i + 1).value ?? `Coluna ${i + 1}`) }));
      worksheet.addTable({ name: op.table.name.replace(/[^A-Za-z0-9_]/g, "_"), ref: op.table.ref, headerRow: true, columns, rows: [], style: { theme: (op.table.style ?? "TableStyleMedium2") as NonNullable<ExcelJS.TableStyleProperties["theme"]> } }).commit();
      return;
    }
    case "addConditionalFormat":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      addConditionalFormat(worksheet, op.rule);
      return;
    case "addDataValidation":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      addValidation(worksheet, op.rule);
      return;
    case "setWidth":
      if (!worksheet) throw new Error(`Aba "${op.sheet}" não encontrada.`);
      worksheet.getColumn(columnToIndex(op.column)).width = op.width;
      return;
  }
}

/** Intervalo A1:B3 → lista de endereços, com teto para evitar abuso. */
export function expandRange(ref: string): string[] {
  const [start, end] = ref.split(":");
  if (!start) return [];
  const colOf = (address: string) => /^[A-Z]+/i.exec(address)?.[0]?.toUpperCase() ?? "A";
  const rowOf = (address: string) => Number(/\d+/.exec(address)?.[0] ?? 1);
  const colIndex = (letters: string) => [...letters].reduce((acc, char) => acc * 26 + (char.charCodeAt(0) - 64), 0);
  const indexCol = (index: number) => {
    let result = "";
    let n = index;
    while (n > 0) {
      const rest = (n - 1) % 26;
      result = String.fromCharCode(65 + rest) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  };
  const c1 = colIndex(colOf(start));
  const c2 = colIndex(colOf(end ?? start));
  const r1 = rowOf(start);
  const r2 = rowOf(end ?? start);
  const cells: string[] = [];
  for (let row = Math.min(r1, r2); row <= Math.max(r1, r2) && cells.length < 10_000; row += 1) {
    for (let col = Math.min(c1, c2); col <= Math.max(c1, c2) && cells.length < 10_000; col += 1) {
      cells.push(`${indexCol(col)}${row}`);
    }
  }
  return cells;
}

export async function editXlsx(bytes: Buffer, input: EditSpreadsheetInput): Promise<{ bytes: Buffer; warnings: string[] }> {
  const original = await loadSafeZip(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  const warnings: string[] = [];
  for (const op of input.operations) {
    if (op.op === "addSheet") {
      addSheetToWorkbook(workbook, op.sheet);
      continue;
    }
    applyNonChartOperation(workbook, op);
  }
  const written = Buffer.from(await workbook.xlsx.writeBuffer());
  const safe = await loadSafeZip(written);
  await preserveCharts(original, safe);

  for (const op of input.operations) {
    if (op.op === "addChart") await appendChart(safe, op.chart);
    else if (op.op === "removeChart") {
      const removed = await removeChartById(safe, op.chartId);
      if (!removed) warnings.push(`Gráfico "${op.chartId}" não encontrado.`);
    }
  }
  await assertRelationshipsResolvable(safe);
  return { bytes: await zipBytes(safe), warnings };
}

/** Prévia HTML estrutural (não é renderização fiel de estilos do Excel). */
export async function renderXlsxHtml(bytes: Buffer, maxRows = 40): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  const sections: string[] = [];
  for (const sheet of workbook.worksheets) {
    const rows: string[] = [];
    let count = 0;
    sheet.eachRow((row) => {
      if (count >= maxRows) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const raw = cell.value;
        const value = typeof raw === "object" && raw && "formula" in raw ? `=${String((raw as { formula: string }).formula)}` : raw;
        cells.push(`<td>${escapeXml(String(value ?? ""))}</td>`);
      });
      rows.push(`<tr>${cells.join("")}</tr>`);
      count += 1;
    });
    sections.push(`<section><h3>${escapeXml(sheet.name)}</h3><table>${rows.join("")}</table></section>`);
  }
  return sections.join("");
}

export async function exportXlsxCsv(bytes: Buffer, sheetName?: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];
  if (!sheet) throw new Error("Aba não encontrada para exportação CSV.");
  const lines: string[] = [];
  sheet.eachRow((row) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const raw = cell.value;
      const value = typeof raw === "object" && raw && "formula" in raw ? String((raw as { formula: string }).formula) : String(raw ?? "");
      values.push(`"${value.replace(/"/g, '""')}"`);
    });
    lines.push(values.join(","));
  });
  return Buffer.from(lines.join("\n"), "utf8");
}

export async function chartIds(bytes: Buffer): Promise<string[]> {
  const safe = await loadSafeZip(bytes);
  const paths = await resolveSheetPaths(safe);
  void paths;
  return [...safe.names].filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name)).map((name) => name.split("/").pop()!.replace(".xml", ""));
}

export function isChartSpec(value: unknown): value is ChartSpec {
  return !!value && typeof value === "object" && "type" in value && "series" in value;
}

export async function validateXlsx(bytes: Buffer): Promise<void> {
  const safe = await loadSafeZip(bytes);
  const workbookXml = await readText(safe, "xl/workbook.xml");
  await assertWellFormed(workbookXml, "workbook.xml");
  await assertRelationshipsResolvable(safe);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(asExcelBuffer(bytes));
  if (!workbook.worksheets.length) throw new Error("Workbook sem abas válidas.");
}
