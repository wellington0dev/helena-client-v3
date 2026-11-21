/**
 * Gráficos XLSX nativos, gravados diretamente em OOXML.
 *
 * `exceljs@4.4.0` não expõe API de gráficos (confirmado por inspeção de runtime:
 * `typeof worksheet.addChart === "undefined"`). Este módulo injeta partes
 * `chartSpace` + `drawing` válidas no pacote gerado pelo ExcelJS. Nenhuma imagem
 * estática é usada: as séries apontam para intervalos de células reais, então o
 * gráfico permanece editável no Excel e no LibreOffice.
 */
import type { ChartSeriesSpec, ChartSpec, NativeChartType } from "./contracts.ts";
import { addRelationship, assertWellFormed, ensureContentType, escapeXml, normalizeZipPath, NS, putText, readText, type SafeZip } from "./ooxml.ts";

const REL_DRAWING = `${NS.officeRel}/drawing`;
const REL_CHART = `${NS.officeRel}/chart`;
const CT_DRAWING = "application/vnd.openxmlformats-officedocument.drawing+xml";
const CT_CHART = "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";

const AX_CAT = "111111111";
const AX_VAL = "222222222";
const EMU_PER_PIXEL = 9525;

type ChartFamily = "bar" | "line" | "pie" | "doughnut" | "area" | "scatter";

interface ChartGroup {
  family: ChartFamily;
  barDir?: "bar" | "col";
  grouping?: string;
  overlap?: number;
  series: ChartSeriesSpec[];
}

function groupsFor(spec: ChartSpec): ChartGroup[] {
  const series = spec.series;
  switch (spec.type) {
    case "column":
      return [{ family: "bar", barDir: "col", grouping: "clustered", series }];
    case "bar":
      return [{ family: "bar", barDir: "bar", grouping: "clustered", series }];
    case "columnStacked":
      return [{ family: "bar", barDir: "col", grouping: "stacked", overlap: 100, series }];
    case "barStacked":
      return [{ family: "bar", barDir: "bar", grouping: "stacked", overlap: 100, series }];
    case "line":
      return [{ family: "line", grouping: "standard", series }];
    case "area":
      return [{ family: "area", grouping: "standard", series }];
    case "pie":
      return [{ family: "pie", series }];
    case "doughnut":
      return [{ family: "doughnut", series }];
    case "scatter":
      return [{ family: "scatter", series }];
    case "combo": {
      const byType = new Map<"column" | "line" | "area", ChartSeriesSpec[]>();
      series.forEach((serie, index) => {
        const type = spec.seriesTypes?.[index] ?? "column";
        byType.set(type, [...(byType.get(type) ?? []), serie]);
      });
      const groups: ChartGroup[] = [];
      const column = byType.get("column");
      if (column?.length) groups.push({ family: "bar", barDir: "col", grouping: "clustered", series: column });
      const line = byType.get("line");
      if (line?.length) groups.push({ family: "line", grouping: "standard", series: line });
      const area = byType.get("area");
      if (area?.length) groups.push({ family: "area", grouping: "standard", series: area });
      return groups;
    }
  }
}

function seriesTitleXml(title: string): string {
  return `<c:tx><c:v>${escapeXml(title)}</c:v></c:tx>`;
}

function categoryXml(ref: string | undefined): string {
  if (!ref) return "";
  return `<c:cat><c:strRef><c:f>${escapeXml(ref)}</c:f></c:strRef></c:cat>`;
}

function valueXml(ref: string): string {
  return `<c:val><c:numRef><c:f>${escapeXml(ref)}</c:f></c:numRef></c:val>`;
}

function seriesXml(group: ChartGroup, serie: ChartSeriesSpec, index: number): string {
  const tx = seriesTitleXml(serie.title);
  const colorIndex = (index % 6) + 2; // evita o preto do tema e dá contraste mínimo
  const spPr = `<c:spPr><a:solidFill><a:schemeClr val="accent${colorIndex}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`;
  switch (group.family) {
    case "bar":
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}${spPr}${categoryXml(serie.categories)}${valueXml(serie.values)}</c:ser>`;
    case "line":
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}${spPr}<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${categoryXml(serie.categories)}${valueXml(serie.values)}<c:smooth val="0"/></c:ser>`;
    case "area":
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}${spPr}${categoryXml(serie.categories)}${valueXml(serie.values)}</c:ser>`;
    case "pie":
    case "doughnut":
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}${spPr}${categoryXml(serie.categories)}${valueXml(serie.values)}</c:ser>`;
    case "scatter":
      return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>${tx}${spPr}<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker><c:xVal><c:numRef><c:f>${escapeXml(serie.xValues ?? serie.categories ?? "")}</c:f></c:numRef></c:xVal>${valueXml(serie.values)}<c:smooth val="0"/></c:ser>`;
  }
}

function groupXml(group: ChartGroup, offset: number): string {
  const series = group.series.map((serie, i) => seriesXml(group, serie, offset + i)).join("");
  switch (group.family) {
    case "bar":
      return `<c:barChart><c:barDir val="${group.barDir}"/><c:grouping val="${group.grouping}"/><c:varyColors val="0"/>${series}<c:gapWidth val="150"/>${group.overlap != null ? `<c:overlap val="${group.overlap}"/>` : ""}<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:barChart>`;
    case "line":
      return `<c:lineChart><c:grouping val="${group.grouping}"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:lineChart>`;
    case "area":
      return `<c:areaChart><c:grouping val="${group.grouping}"/><c:varyColors val="0"/>${series}<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:areaChart>`;
    case "pie":
      return `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`;
    case "doughnut":
      return `<c:doughnutChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`;
    case "scatter":
      return `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}<c:axId val="${AX_CAT}"/><c:axId val="${AX_VAL}"/></c:scatterChart>`;
  }
}

function axesXml(type: NativeChartType): string {
  if (type === "pie" || type === "doughnut") return "";
  const isScatter = type === "scatter";
  const catPos = "b";
  const valPos = "l";
  return (
    `<c:catAx><c:axId val="${AX_CAT}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="${catPos}"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${AX_VAL}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>` +
    `<c:noMultiLvlLbl val="0"/>${isScatter ? '<c:numFmt formatCode="General" sourceLinked="1"/>' : ""}</c:catAx>` +
    `<c:valAx><c:axId val="${AX_VAL}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/>` +
    `<c:axPos val="${valPos}"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/>` +
    `<c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>` +
    `<c:crossAx val="${AX_CAT}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`
  );
}

function titleXml(title?: string): string {
  if (!title) return "";
  return (
    `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr>` +
    `<a:r><a:rPr lang="pt-BR"/><a:t>${escapeXml(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`
  );
}

export function buildChartXml(spec: ChartSpec): string {
  if (!spec.series.length) throw new Error(`Gráfico ${spec.id} não possui séries.`);
  const groups = groupsFor(spec);
  let offset = 0;
  const plotGroups = groups.map((group) => {
    const xml = groupXml(group, offset);
    offset += group.series.length;
    return xml;
  });
  const legend = spec.legend === false ? "" : `<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>`;
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<c:chartSpace xmlns:c="${NS.chart}" xmlns:a="${NS.drawing}" xmlns:r="${NS.officeRel}">` +
    `<c:date1904 val="0"/>` +
    `<c:chart>${titleXml(spec.title)}<c:autoTitleDeleted val="0"/>` +
    `<c:plotArea><c:layout/>${plotGroups.join("")}${axesXml(spec.type)}</c:plotArea>` +
    `${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>` +
    `<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings>` +
    `</c:chartSpace>`;
  return xml;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0]?.toUpperCase();
  if (!letters) return 0;
  let index = 0;
  for (const char of letters) index = index * 26 + (char.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

function rowIndex(ref: string): number {
  const row = /\d+/.exec(ref)?.[0];
  return row ? Math.max(0, Number(row) - 1) : 0;
}

/** Um `oneCellAnchor` por gráfico, dentro do `wsDr` da planilha. */
export function buildDrawingAnchor(spec: ChartSpec, drawingId: number, chartRelId: string): string {
  const anchorCol = columnIndex(spec.anchor ?? "D2");
  const anchorRow = rowIndex(spec.anchor ?? "D2");
  const cx = Math.max(1, Math.round((spec.width ?? 600) * EMU_PER_PIXEL));
  const cy = Math.max(1, Math.round((spec.height ?? 360) * EMU_PER_PIXEL));
  return (
    `<xdr:oneCellAnchor>` +
    `<xdr:from><xdr:col>${anchorCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchorRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${cx}" cy="${cy}"/>` +
    `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${drawingId}" name="${escapeXml(spec.id)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
    `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
    `<a:graphic><a:graphicData uri="${NS.chart}"><c:chart xmlns:c="${NS.chart}" xmlns:r="${NS.officeRel}" r:id="${chartRelId}"/></a:graphicData></a:graphic>` +
    `</xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>`
  );
}

export function emptyDrawing(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${NS.drawing}"></xdr:wsDr>`;
}

/** Mapa nome da aba → caminho da parte `xl/worksheets/sheetN.xml`. */
export async function resolveSheetPaths(safe: SafeZip): Promise<Map<string, string>> {
  const workbook = await readText(safe, "xl/workbook.xml");
  const relsXml = await readText(safe, "xl/_rels/workbook.xml.rels");
  const rels = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?xl\//, "").replace(/^\//, ""));
  }
  const result = new Map<string, string>();
  for (const match of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = /name="([^"]+)"/.exec(tag)?.[1];
    const rid = /r:id="([^"]+)"/.exec(tag)?.[1];
    if (!name || !rid) continue;
    const target = rels.get(rid);
    if (target) result.set(name.replace(/&amp;/g, "&"), `xl/${target.replace(/^\/?xl\//, "")}`);
  }
  return result;
}

/** Insere `<drawing r:id>` na posição válida do schema CT_Worksheet. */
function ensureDrawingTag(sheetXml: string, relId: string): string {
  if (/<drawing\b/.test(sheetXml)) return sheetXml.replace(/<drawing\b[^>]*\/>/, `<drawing r:id="${relId}"/>`);
  const tag = `<drawing r:id="${relId}"/>`;
  const before = /<(tableParts|extLst)\b/.exec(sheetXml);
  if (before) return sheetXml.slice(0, before.index) + tag + sheetXml.slice(before.index);
  return sheetXml.replace(/<\/worksheet>\s*$/, `${tag}</worksheet>`);
}

/**
 * Injeta um conjunto de gráficos em um pacote XLSX já gerado. Reagrupa todos
 * os gráficos da mesma aba em um único `drawing` (o schema permite no máximo
 * um elemento `<drawing>` por worksheet).
 */
export async function injectCharts(safe: SafeZip, specs: ChartSpec[]): Promise<void> {
  if (!specs.length) return;
  const sheetPaths = await resolveSheetPaths(safe);
  const bySheet = new Map<string, ChartSpec[]>();
  for (const spec of specs) {
    if (!sheetPaths.has(spec.sheet)) {
      throw new Error(`Aba "${spec.sheet}" não existe para o gráfico "${spec.id}".`);
    }
    bySheet.set(spec.sheet, [...(bySheet.get(spec.sheet) ?? []), spec]);
  }

  let chartSeq = 1;
  for (const [sheetName, sheetSpecs] of bySheet) {
    const sheetPath = sheetPaths.get(sheetName)!;
    const relsPath = `${sheetPath.slice(0, sheetPath.lastIndexOf("/") + 1)}_rels/${sheetPath.split("/").pop()}.rels`;
    const drawingIndex = (await countParts(safe, "xl/drawings/drawing")) + 1;
    const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
    const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;

    let drawingXml = emptyDrawing();
    const anchors: string[] = [];
    for (const spec of sheetSpecs) {
      const chartXml = buildChartXml(spec);
      await assertWellFormed(chartXml, `gráfico ${spec.id}`);
      const chartPath = `xl/charts/chart${chartSeq}.xml`;
      putText(safe, chartPath, chartXml);
      const chartRelId = await addRelationship(safe, drawingRelsPath, REL_CHART, `../charts/chart${chartSeq}.xml`);
      anchors.push(buildDrawingAnchor(spec, chartSeq + 1, chartRelId));
      chartSeq += 1;
    }
    drawingXml = drawingXml.replace(/<\/xdr:wsDr>\s*$/, `${anchors.join("")}</xdr:wsDr>`);
    await assertWellFormed(drawingXml, `drawing de ${sheetName}`);
    putText(safe, drawingPath, drawingXml);

    const drawingRelId = await addRelationship(safe, relsPath, REL_DRAWING, `../drawings/drawing${drawingIndex}.xml`);
    const sheetXml = await readText(safe, sheetPath);
    putText(safe, sheetPath, ensureDrawingTag(sheetXml, drawingRelId));

    await ensureContentType(safe, `/${drawingPath}`, CT_DRAWING);
    let contentTypes = await readText(safe, "[Content_Types].xml");
    for (let i = 1; i < chartSeq; i += 1) {
      const part = `/xl/charts/chart${i}.xml`;
      if (!contentTypes.includes(`PartName="${part}"`)) {
        contentTypes = contentTypes.replace(/<\/Types>\s*$/, `<Override PartName="${part}" ContentType="${CT_CHART}"/></Types>`);
      }
    }
    putText(safe, "[Content_Types].xml", contentTypes);
  }
  await assertWellFormed(await readText(safe, "[Content_Types].xml"), "Content_Types");
}

/**
 * Reanexa gráficos de um XLSX original a um XLSX reescrito pelo ExcelJS.
 * O ExcelJS não preserva drawings ao fazer load/save; copiamos as partes de
 * gráfico e seus relacionamentos para que edições não destruam gráficos já
 * existentes. A correspondência é por índice de aba (sheetN.xml), estável
 * enquanto a ordem das abas for mantida.
 */
export async function preserveCharts(original: SafeZip, target: SafeZip): Promise<void> {
  const chartParts = [...original.names].filter(
    (name) => name.startsWith("xl/charts/") || name.startsWith("xl/drawings/"),
  );
  for (const name of chartParts) {
    const entry = original.zip.file(name);
    if (!entry) continue;
    target.zip.file(name, await entry.async("nodebuffer"));
    target.names.add(name);
  }
  for (const name of [...original.names]) {
    if (!/^xl\/worksheets\/_rels\/sheet\d+\.xml\.rels$/.test(name)) continue;
    const rels = await readText(original, name);
    if (!rels.includes(REL_DRAWING)) continue;
    const targetSheet = name.replace("/_rels/", "/").replace(/\.rels$/, "");
    if (!target.names.has(targetSheet)) continue;
    const relationships = [...rels.matchAll(/<Relationship\b[^>]*\/>/g)].map((m) => m[0]).filter((tag) => tag.includes(REL_DRAWING));
    if (!relationships.length) continue;
    const targetRelsPath = name;
    let targetRels = target.zip.file(targetRelsPath) ? await readText(target, targetRelsPath) : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.packageRel}"></Relationships>`;
    for (const relationship of relationships) {
      const id = /Id="([^"]+)"/.exec(relationship)?.[1] ?? "rId1";
      if (targetRels.includes(`Id="${id}"`)) continue;
      targetRels = targetRels.replace(/<\/Relationships>\s*$/, `${relationship}</Relationships>`);
      const sheetXml = await readText(target, targetSheet);
      if (!/<drawing\b/.test(sheetXml)) {
        putText(target, targetSheet, ensureDrawingTag(sheetXml, id));
      }
    }
    putText(target, targetRelsPath, targetRels);
  }
  const originalTypes = await readText(original, "[Content_Types].xml");
  let targetTypes = await readText(target, "[Content_Types].xml");
  for (const match of originalTypes.matchAll(/<Override\b[^>]*\/>/g)) {
    const tag = match[0];
    if (!/xl\/(charts|drawings)\//.test(tag)) continue;
    const part = /PartName="([^"]+)"/.exec(tag)?.[1];
    if (part && !targetTypes.includes(`PartName="${part}"`)) {
      targetTypes = targetTypes.replace(/<\/Types>\s*$/, `${tag}</Types>`);
    }
  }
  putText(target, "[Content_Types].xml", targetTypes);
}

/** Acrescenta um gráfico a uma aba que já possui drawing (caso de edição). */
export async function appendChart(safe: SafeZip, spec: ChartSpec): Promise<void> {
  const sheetPaths = await resolveSheetPaths(safe);
  const sheetPath = sheetPaths.get(spec.sheet);
  if (!sheetPath) throw new Error(`Aba "${spec.sheet}" não existe.`);
  const relsPath = `${sheetPath.slice(0, sheetPath.lastIndexOf("/") + 1)}_rels/${sheetPath.split("/").pop()}.rels`;
  let relsXml = safe.zip.file(relsPath) ? await readText(safe, relsPath) : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.packageRel}"></Relationships>`;
  let drawingRel = /<Relationship\b[^>]*Type="[^"]*\/drawing"[^>]*\/>/.exec(relsXml)?.[0];
  let drawingRelId = drawingRel ? /Id="([^"]+)"/.exec(drawingRel)?.[1]! : "";
  let drawingIndex = 1;
  if (!drawingRelId) {
    while (safe.names.has(`xl/drawings/drawing${drawingIndex}.xml`)) drawingIndex += 1;
    const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
    putText(safe, drawingPath, emptyDrawing());
    drawingRelId = await addRelationship(safe, relsPath, REL_DRAWING, `../drawings/drawing${drawingIndex}.xml`);
    await ensureContentType(safe, `/${drawingPath}`, CT_DRAWING);
    const sheetXml = await readText(safe, sheetPath);
    putText(safe, sheetPath, ensureDrawingTag(sheetXml, drawingRelId));
  } else {
    const target = /Target="([^"]+)"/.exec(drawingRel!)?.[1] ?? "../drawings/drawing1.xml";
    const resolved = normalizeZipPath(`xl/worksheets/${target}`);
    drawingIndex = Number(/drawing(\d+)\.xml/.exec(resolved)?.[1] ?? 1);
  }

  let chartSeq = 1;
  while (safe.names.has(`xl/charts/chart${chartSeq}.xml`)) chartSeq += 1;
  const chartXml = buildChartXml(spec);
  await assertWellFormed(chartXml, `gráfico ${spec.id}`);
  putText(safe, `xl/charts/chart${chartSeq}.xml`, chartXml);
  const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;
  const chartRelId = await addRelationship(safe, drawingRelsPath, REL_CHART, `../charts/chart${chartSeq}.xml`);
  const drawingPath = `xl/drawings/drawing${drawingIndex}.xml`;
  const drawingXml = await readText(safe, drawingPath);
  const nextId = (([...drawingXml.matchAll(/<xdr:cNvPr id="(\d+)"/g)].reduce((acc, m) => Math.max(acc, Number(m[1])), 0)) || 0) + 1;
  putText(safe, drawingPath, drawingXml.replace(/<\/xdr:wsDr>\s*$/, `${buildDrawingAnchor(spec, nextId + 1, chartRelId)}</xdr:wsDr>`));
  let contentTypes = await readText(safe, "[Content_Types].xml");
  const part = `/xl/charts/chart${chartSeq}.xml`;
  if (!contentTypes.includes(`PartName="${part}"`)) {
    contentTypes = contentTypes.replace(/<\/Types>\s*$/, `<Override PartName="${part}" ContentType="${CT_CHART}"/></Types>`);
  }
  putText(safe, "[Content_Types].xml", contentTypes);
}

async function countParts(safe: SafeZip, prefix: string): Promise<number> {
  let count = 0;
  for (const name of safe.names) if (name.startsWith(prefix) && name.endsWith(".xml")) count += 1;
  return count;
}

/**
 * Remove um gráfico por id lógico (nome da parte `chartN.xml`). Usado por
 * `spreadsheet.removeChart`. Não remove dados das células.
 */
export async function removeChartById(safe: SafeZip, chartId: string): Promise<boolean> {
  const safeId = /^chart\d+$/.test(chartId) ? chartId : "";
  if (!safeId) return false;
  const chartPath = `xl/charts/${safeId}.xml`;
  if (!safe.names.has(chartPath)) return false;
  safe.zip.remove(chartPath);
  safe.names.delete(chartPath);
  for (const name of [...safe.names]) {
    if (!name.startsWith("xl/drawings/_rels/") || !name.endsWith(".rels")) continue;
    const rels = await readText(safe, name);
    const target = `../charts/${safeId}.xml`;
    if (!rels.includes(target)) continue;
    const rid = /<Relationship Id="([^"]+)"[^>]*Target="\.\.\/charts\/chart\d+\.xml"/.exec(
      rels.replace(/>([^<]*)</g, ">$1<"),
    )?.[1];
    const removedRels = rels.replace(/<Relationship\b[^>]*\/>/g, (tag) => (tag.includes(target) ? "" : tag));
    putText(safe, name, removedRels);
    if (rid) {
      const drawingPath = name.replace("/_rels/", "/").replace(/\.rels$/, "");
      if (safe.names.has(drawingPath)) {
        const drawing = await readText(safe, drawingPath);
        const stripped = drawing.replace(/<xdr:oneCellAnchor\b[\s\S]*?<\/xdr:oneCellAnchor>/g, (anchor) =>
          anchor.includes(`r:id="${rid}"`) ? "" : anchor,
        );
        putText(safe, drawingPath, stripped);
      }
    }
  }
  return true;
}
