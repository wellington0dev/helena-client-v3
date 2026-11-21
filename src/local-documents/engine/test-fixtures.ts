/** Fixtures reais de documentos para os testes da Document Engine (somente teste). */
import JSZip from "jszip";
import { createDocx } from "./docx-engine.ts";
import { createXlsx } from "./xlsx-engine.ts";
import { createPdf } from "./pdf-engine.ts";
import type { CreateDocumentInput, CreateSpreadsheetInput } from "./contracts.ts";

export function sampleDocx(overrides: Partial<CreateDocumentInput> = {}): Promise<Buffer> {
  return createDocx({
    format: "docx",
    workspaceId: "ws-test",
    filename: "relatorio.docx",
    title: "Relatório Trimestral",
    blocks: [
      { type: "heading", text: "Introdução", level: 1 },
      { type: "paragraph", text: "Receita de 1,2 milhões no trimestre." },
      { type: "bullet", text: "Crescer 20%" },
      { type: "numbered", text: "Abrir 3 filiais" },
      { type: "quote", text: "Execução acima do plano." },
    ],
    table: { rows: [["Mês", "Receita"], ["Jan", "100"], ["Fev", "120"]], headerRow: true },
    section: { header: "Confidencial", footer: "Página 1", margins: { left: 1200 }, orientation: "portrait" },
    ...overrides,
  });
}

export function sampleXlsx(overrides: Partial<CreateSpreadsheetInput> = {}): Promise<Buffer> {
  return createXlsx({
    format: "xlsx",
    workspaceId: "ws-test",
    filename: "vendas.xlsx",
    sheets: [
      {
        name: "Vendas",
        rows: [["Mês", "Receita", "Meta"], ["Jan", 100, 90], ["Fev", 120, 110], ["Mar", 95, 100]],
        cells: [{ ref: "D2", formula: "B2-C2" }, { ref: "D3", formula: "B3-C3" }],
        freeze: "A2",
        autoFilter: "A1:C4",
        widths: [{ column: "A", width: 14 }],
        tables: [{ name: "TabelaVendas", ref: "A1:C4", style: "TableStyleMedium2" }],
        conditionalFormats: [
          { ref: "B2:B4", type: "cellIs", operator: "greaterThan", formula: ["100"] },
          { ref: "C2:C4", type: "colorScale" },
        ],
        dataValidations: [{ ref: "B2:B4", type: "whole", operator: "greaterThan", formula1: "0" }],
      },
      { name: "Resumo", rows: [["Indicador", "Valor"], ["Total", 315]] },
    ],
    charts: [
      {
        id: "chartReceita",
        type: "column",
        title: "Receita por mês",
        sheet: "Vendas",
        series: [{ title: "Receita", categories: "Vendas!A2:A4", values: "Vendas!B2:B4" }],
        anchor: "F2",
      },
    ],
    ...overrides,
  }).then((result) => result.bytes);
}

export function samplePdf(): Promise<Buffer> {
  return createPdf("Relatório PDF", "Primeira página com texto selecionável.\nSegundo parágrafo.");
}

/** PNG 1x1 transparente válido, usado como parte `ppt/media`. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF+gX8AAAAASUVORK5CYII=",
  "base64",
);

/**
 * PPTX mínimo, porém estruturalmente válido: todas as relationships internas
 * apontam para partes existentes. Serve para validar inspeção/leitura sem
 * depender de um renderizador externo (ausente neste ambiente).
 */
export async function samplePptx(): Promise<Buffer> {
  const zip = new JSZip();
  const put = (name: string, xml: string) => zip.file(name, xml);
  const decl = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const relNs = "http://schemas.openxmlformats.org/package/2006/relationships";
  const rels = (items: Array<[string, string, string]>) =>
    decl + `<Relationships xmlns="${relNs}">` +
    items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("") +
    "</Relationships>";
  const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

  put("[Content_Types].xml", decl + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
    <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
    <Default Extension="xml" ContentType="application/xml"/>
    <Default Extension="png" ContentType="image/png"/>
    <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
    <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
    <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
    <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
    <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
    <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
    <Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>
    <Override PartName="/ppt/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
    <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
    <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  </Types>`);

  put("_rels/.rels", rels([
    ["rId1", OFFICE + "officeDocument", "ppt/presentation.xml"],
    ["rId2", OFFICE + "metadata/core-properties", "docProps/core.xml"],
    ["rId3", OFFICE + "extended-properties", "docProps/app.xml"],
  ]));
  put("docProps/core.xml", decl + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Apresentação de teste</dc:title></cp:coreProperties>`);
  put("docProps/app.xml", decl + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office PowerPoint</Application><Slides>2</Slides></Properties>`);

  put("ppt/presentation.xml", decl + `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
    <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId3"/></p:sldMasterIdLst>
    <p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
    <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
    <p:notesSz cx="6858000" cy="9144000"/>
  </p:presentation>`);
  put("ppt/_rels/presentation.xml.rels", rels([
    ["rId1", OFFICE + "slide", "slides/slide1.xml"],
    ["rId2", OFFICE + "slide", "slides/slide2.xml"],
    ["rId3", OFFICE + "slideMaster", "slideMasters/slideMaster1.xml"],
    ["rId4", OFFICE + "theme", "theme/theme1.xml"],
  ]));

  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const slide = (title: string, body: string, withTable: boolean) =>
    decl + `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp><p:nvSpPr><p:cNvPr id="2" name="Título"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR"/><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:cNvPr id="3" name="Conteúdo"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="pt-BR"/><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
      ${withTable ? `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Tabela"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>` : ""}
    </p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  put("ppt/slides/slide1.xml", slide("-resultados do trimestre-", "Receita acima do plano", true));
  put("ppt/slides/slide2.xml", slide("Próximos passos", "Expandir para novas regiões", false));
  put("ppt/slides/_rels/slide1.xml.rels", rels([
    ["rId1", OFFICE + "slideLayout", "../slideLayouts/slideLayout1.xml"],
    ["rId2", OFFICE + "image", "../media/image1.png"],
    ["rId3", OFFICE + "chart", "../charts/chart1.xml"],
    ["rId4", OFFICE + "notesSlide", "../notesSlides/notesSlide1.xml"],
  ]));
  put("ppt/slides/_rels/slide2.xml.rels", rels([
    ["rId1", OFFICE + "slideLayout", "../slideLayouts/slideLayout1.xml"],
  ]));
  zip.file("ppt/media/image1.png", TINY_PNG);
  put("ppt/charts/chart1.xml", decl + `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="${A}"><c:chart><c:plotArea><c:pieChart><c:ser><c:idx val="0"/><c:order val="0"/></c:ser></c:pieChart></c:plotArea></c:chart></c:chartSpace>`);
  put("ppt/notesSlides/notesSlide1.xml", decl + `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:t>Nota do palestrante</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);
  put("ppt/notesSlides/_rels/notesSlide1.xml.rels", rels([
    ["rId1", OFFICE + "slide", "../slides/slide1.xml"],
  ]));

  put("ppt/slideLayouts/slideLayout1.xml", decl + `<p:sldLayout xmlns:p="${P}" xmlns:a="${A}" type="blank" preserve="1"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`);
  put("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([
    ["rId1", OFFICE + "slideMaster", "../slideMasters/slideMaster1.xml"],
  ]));
  put("ppt/slideMasters/slideMaster1.xml", decl + `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>`);
  put("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([
    ["rId1", OFFICE + "slideLayout", "../slideLayouts/slideLayout1.xml"],
    ["rId2", OFFICE + "theme", "../theme/theme1.xml"],
  ]));
  put("ppt/theme/theme1.xml", decl + `<a:theme xmlns:a="${A}" name="Teste"><a:themeElements><a:clrScheme name="Teste"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Teste"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Teste"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`);

  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}
