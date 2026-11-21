/**
 * Edição DOCX preservadora: modifica apenas `word/document.xml` (mais partes
 * explicitamente tocadas, como cabeçalho/rodapé/mídia), mantendo byte a byte
 * todos os demais membros do pacote — estilos, relações desconhecidas, temas,
 * conteúdo de terceiros. Nunca reconstrói o documento do zero.
 */
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

// @xmldom/xmldom expõe os tipos DOM globais (via `/// <reference lib="dom" />`),
// não exports nomeados. Aliases locais mantêm o código legível.
type XDocument = Document;
type XElement = Element;
type XNode = Node;
import type { DocxOperation, DocxSectionSpec, DocxTableSpec } from "./contracts.ts";
import { addRelationship, assertRelationshipsResolvable, assertWellFormed, ensureContentType, escapeXml, loadSafeZip, NS, putText, readText, zipBytes, ZIP_PART } from "./ooxml.ts";

const W = NS.wordprocessing;
const CONTENT_TYPE_HEADER = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
const CONTENT_TYPE_FOOTER = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
const CONTENT_TYPE_PNG = "image/png";
const CONTENT_TYPE_JPEG = "image/jpeg";
const CONTENT_TYPE_GIF = "image/gif";

export interface EditReport {
  applied: string[];
  limitations: string[];
}

function parseXml(xml: string): XDocument {
  const doc = new DOMParser({ errorHandler: { warning: () => undefined, error: (message: string) => { throw new Error(message); }, fatalError: (message: string) => { throw new Error(message); } } }).parseFromString(xml, "application/xml");
  if (!doc.documentElement) throw new Error("Falha ao interpretar document.xml.");
  return doc;
}

function serialize(doc: XDocument): string {
  // XMLSerializer preserva a declaração XML original quando o documento veio
  // de parseFromString — prefixar outra geraria duas declarações (XML inválido).
  return new XMLSerializer().serializeToString(doc);
}

function setAttr(element: XElement, name: string, value: string): void {
  if (element.hasAttributeNS(W, name) || element.namespaceURI === W) element.setAttributeNS(W, `w:${name}`, value);
  else element.setAttribute(name, value);
}

function paragraphText(paragraph: XElement): string {
  const texts = paragraph.getElementsByTagNameNS(W, "t");
  let out = "";
  for (let i = 0; i < texts.length; i += 1) out += texts[i]!.textContent ?? "";
  return out;
}

function bodyOf(doc: XDocument): XElement {
  const bodies = doc.documentElement.getElementsByTagNameNS(W, "body");
  const body = bodies[0];
  if (!body) throw new Error("DOCX sem corpo.");
  return body;
}

function sectPrOf(body: XElement): XElement | undefined {
  const found = Array.from(body.childNodes as NodeListOf<XNode>).find(
    (node): node is XElement => node.nodeType === 1 && (node as XElement).localName === "sectPr",
  );
  return found;
}

function findParagraphs(doc: XDocument, find: string): XElement[] {
  return Array.from(doc.documentElement.getElementsByTagNameNS(W, "p")).filter((p) => paragraphText(p).includes(find));
}

function insertAfter(reference: XNode, node: XNode): void {
  const parent = reference.parentNode;
  if (!parent) return;
  if (reference.nextSibling) parent.insertBefore(node, reference.nextSibling);
  else parent.appendChild(node);
}

function ensureFirstChild(element: XElement, name: string): XElement {
  const existing = Array.from(element.childNodes as NodeListOf<XNode>).find(
    (node): node is XElement => node.nodeType === 1 && (node as XElement).localName === name,
  );
  if (existing) return existing;
  const created = element.ownerDocument!.createElementNS(W, `w:${name}`);
  if (element.firstChild) element.insertBefore(created, element.firstChild);
  else element.appendChild(created);
  return created;
}

function ensurePPr(paragraph: XElement): XElement {
  return ensureFirstChild(paragraph, "pPr");
}

function setPPrValue(paragraph: XElement, tag: string, value: string): void {
  const pPr = ensurePPr(paragraph);
  let child = Array.from(pPr.childNodes as NodeListOf<XNode>).find(
    (node): node is XElement => node.nodeType === 1 && (node as XElement).localName === tag,
  );
  if (!child) {
    child = pPr.ownerDocument!.createElementNS(W, `w:${tag}`);
    pPr.appendChild(child);
  }
  setAttr(child, "val", value);
}

function ensureRPr(run: XElement): XElement {
  return ensureFirstChild(run, "rPr");
}

function setRPrValue(run: XElement, tag: string, value: string): void {
  const rPr = ensureRPr(run);
  let child = Array.from(rPr.childNodes as NodeListOf<XNode>).find(
    (node): node is XElement => node.nodeType === 1 && (node as XElement).localName === tag,
  );
  if (!child) {
    child = rPr.ownerDocument!.createElementNS(W, `w:${tag}`);
    rPr.appendChild(child);
  }
  setAttr(child, "val", value);
}

function runsOf(paragraph: XElement): XElement[] {
  return Array.from(paragraph.getElementsByTagNameNS(W, "r"));
}

function textNodesOf(paragraph: XElement): XElement[] {
  return Array.from(paragraph.getElementsByTagNameNS(W, "t"));
}

function fragment(doc: XDocument, xml: string): XNode {
  const parsed = new DOMParser().parseFromString(xml, "application/xml");
  if (!parsed.documentElement) throw new Error("Fragmento OOXML inválido.");
  return doc.importNode(parsed.documentElement, true);
}

function paragraphXml(text: string, options: { style?: string; align?: string } = {}): string {
  const pPr = [
    options.style ? `<w:pStyle w:val="${escapeXml(options.style)}"/>` : "",
    options.align ? `<w:jc w:val="${escapeXml(options.align)}"/>` : "",
  ].join("");
  return (
    `<w:p xmlns:w="${W}">${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function tableXml(spec: DocxTableSpec): string {
  const rows = spec.rows.map((cells, rowIndex) => {
    const cellXml = cells.map((value, columnIndex) => {
      const meta = spec.spans?.[rowIndex]?.[columnIndex];
      const props = [
        meta?.colSpan ? `<w:gridSpan w:val="${meta.colSpan}"/>` : "",
        meta?.rowSpan ? `<w:vMerge w:val="restart"/>` : "",
        meta?.shading || spec.shading?.[rowIndex % spec.shading.length]
          ? `<w:shd w:fill="${escapeXml((meta?.shading ?? spec.shading?.[rowIndex % spec.shading.length])!.replace("#", ""))}"/>`
          : "",
      ].join("");
      return `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ""}<w:p><w:r>${spec.headerRow && rowIndex === 0 ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t>${escapeXml(value)}</w:t></w:r></w:p></w:tc>`;
    }).join("");
    return `<w:tr>${spec.headerRow && rowIndex === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ""}${cellXml}</w:tr>`;
  }).join("");
  return `<w:tbl xmlns:w="${W}"><w:tblPr><w:tblW w:w="5000" w:type="pct"/></w:tblPr>${rows}</w:tbl>`;
}

function imageXml(id: number, relId: string, width: number, height: number, filename: string): string {
  const cx = Math.round(width * 9525);
  const cy = Math.round(height * 9525);
  return (
    `<w:p xmlns:w="${W}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:r="${NS.officeRel}">` +
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="${escapeXml(filename)}"/><wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="${NS.drawing}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="${escapeXml(filename)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
  );
}

function applyReplace(paragraph: XElement, find: string, replace: string): boolean {
  const texts = textNodesOf(paragraph);
  if (!texts.length) return false;
  const original = texts.map((node) => node.textContent ?? "").join("");
  if (!original.includes(find)) return false;
  const updated = original.split(find).join(replace);
  texts[0]!.textContent = updated;
  for (let i = 1; i < texts.length; i += 1) texts[i]!.textContent = "";
  return true;
}

function applyFont(paragraph: XElement, op: Extract<DocxOperation, { op: "setFont" }>): void {
  for (const run of runsOf(paragraph)) {
    if (op.font) setRPrValue(run, "rFonts", op.font);
    if (op.size) setRPrValue(run, "sz", String(Math.round(op.size * 2)));
    if (op.color) setRPrValue(run, "color", op.color.replace(/^#/, ""));
    if (op.bold !== undefined) {
      const rPr = ensureRPr(run);
      if (op.bold && !Array.from(rPr.childNodes).some((n) => (n as XElement).localName === "b")) {
        rPr.appendChild(rPr.ownerDocument!.createElementNS(W, "w:b"));
      }
    }
    if (op.italic !== undefined) {
      const rPr = ensureRPr(run);
      if (op.italic && !Array.from(rPr.childNodes).some((n) => (n as XElement).localName === "i")) {
        rPr.appendChild(rPr.ownerDocument!.createElementNS(W, "w:i"));
      }
    }
  }
}

function applySection(sectPr: XElement, section: DocxSectionSpec): void {
  if (section.margins) {
    let pgMar = Array.from(sectPr.childNodes).find((n) => (n as XElement).localName === "pgMar") as XElement | undefined;
    if (!pgMar) {
      pgMar = sectPr.ownerDocument!.createElementNS(W, "w:pgMar");
      sectPr.appendChild(pgMar);
    }
    for (const [key, value] of Object.entries(section.margins)) {
      if (value !== undefined) pgMar.setAttributeNS(W, `w:${key}`, String(value));
    }
  }
  if (section.orientation) {
    let pgSz = Array.from(sectPr.childNodes).find((n) => (n as XElement).localName === "pgSz") as XElement | undefined;
    if (!pgSz) {
      pgSz = sectPr.ownerDocument!.createElementNS(W, "w:pgSz");
      sectPr.appendChild(pgSz);
    }
    pgSz.setAttributeNS(W, "w:orient", section.orientation);
    const width = Number(pgSz.getAttributeNS(W, "w") || 12240);
    const height = Number(pgSz.getAttributeNS(W, "h") || 15840);
    const landscape = section.orientation === "landscape";
    if ((landscape && width < height) || (!landscape && width > height)) {
      pgSz.setAttributeNS(W, "w:w", String(height));
      pgSz.setAttributeNS(W, "w:h", String(width));
    }
  }
}

/** Aplica uma lista de operações preservando todas as partes não tocadas. */
export async function editDocx(bytes: Buffer, operations: DocxOperation[]): Promise<{ bytes: Buffer; report: EditReport }> {
  const safe = await loadSafeZip(bytes);
  const documentXml = await readText(safe, ZIP_PART.docxDocument);
  const doc = parseXml(documentXml);
  const body = bodyOf(doc);
  const report: EditReport = { applied: [], limitations: [] };
  let mediaSeq = 0;
  for (const name of safe.names) {
    const match = /^word\/media\/image(\d+)\./.exec(name);
    if (match) mediaSeq = Math.max(mediaSeq, Number(match[1]));
  }
  let docPrSeq = 0;
  for (const match of documentXml.matchAll(/<wp:docPr id="(\d+)"/g)) docPrSeq = Math.max(docPrSeq, Number(match[1]));

  for (const op of operations) {
    switch (op.op) {
      case "replaceText": {
        const targets = findParagraphs(doc, op.find);
        if (!targets.length) {
          report.limitations.push(`Texto "${op.find}" não encontrado; nada foi alterado.`);
          break;
        }
        let changed = 0;
        for (const p of targets) if (applyReplace(p, op.find, op.replace)) changed += 1;
        if (changed > 0 && op.find.length !== op.replace.length) {
          report.limitations.push("Substituição redistribuiu o texto entre as runs existentes; formatação de runs intermediários pode ser simplificada.");
        }
        report.applied.push(`replaceText (${changed})`);
        break;
      }
      case "setStyle":
      case "setAlignment": {
        const targets = findParagraphs(doc, op.find);
        for (const p of targets) {
          if (op.op === "setStyle") setPPrValue(p, "pStyle", op.style);
          else setPPrValue(p, "jc", op.align);
        }
        report.applied.push(`${op.op} (${targets.length})`);
        if (!targets.length) report.limitations.push(`Texto "${op.find}" não encontrado.`);
        break;
      }
      case "setFont": {
        const targets = findParagraphs(doc, op.find);
        for (const p of targets) applyFont(p, op);
        report.applied.push(`setFont (${targets.length})`);
        if (!targets.length) report.limitations.push(`Texto "${op.find}" não encontrado.`);
        break;
      }
      case "insertParagraph":
      case "insertTable":
      case "insertImage":
      case "pageBreak": {
        let node: XNode;
        if (op.op === "insertParagraph") node = fragment(doc, paragraphXml(op.text, { style: op.style, align: op.align }));
        else if (op.op === "insertTable") node = fragment(doc, tableXml(op.table));
        else if (op.op === "pageBreak") node = fragment(doc, '<w:p xmlns:w="' + W + '"><w:r><w:br w:type="page"/></w:r></w:p>');
        else {
          const extension = op.image.mimeType.split("/")[1]!;
          const base64 = op.image.base64.replace(/^data:[^;]+;base64,/, "");
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new Error("Base64 de imagem inválido.");
          mediaSeq += 1;
          const mediaPath = `word/media/image${mediaSeq}.${extension}`;
          safe.zip.file(mediaPath, Buffer.from(base64, "base64"));
          safe.names.add(mediaPath);
          const relId = await addRelationship(safe, "word/_rels/document.xml.rels", `${NS.officeRel}/image`, `media/image${mediaSeq}.${extension}`);
          docPrSeq += 1;
          node = fragment(doc, imageXml(docPrSeq, relId, op.image.width ?? 480, op.image.height ?? 320, `image${mediaSeq}.${extension}`));
          await ensureContentType(safe, `/${mediaPath}`, extension === "png" ? CONTENT_TYPE_PNG : extension === "gif" ? CONTENT_TYPE_GIF : CONTENT_TYPE_JPEG);
        }
        const anchor = op.afterText ? findParagraphs(doc, op.afterText).at(-1) : undefined;
        if (anchor) insertAfter(anchor, node);
        else {
          const sect = sectPrOf(body);
          if (sect) body.insertBefore(node, sect);
          else body.appendChild(node);
        }
        report.applied.push(op.op);
        if (op.afterText && !anchor) report.limitations.push(`Âncora "${op.afterText}" não encontrada; elemento inserido no fim.`);
        break;
      }
      case "setHeader":
      case "setFooter": {
        const kind = op.op === "setHeader" ? "header" : "footer";
        const part = `word/${kind}1.xml`;
        const rootTag = kind === "header" ? "hdr" : "ftr";
        const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${rootTag} xmlns:w="${W}"><w:p><w:r><w:t>${escapeXml(op.text)}</w:t></w:r></w:p></w:${rootTag}>`;
        await assertWellFormed(xml, kind);
        putText(safe, part, xml);
        const relId = await addRelationship(safe, "word/_rels/document.xml.rels", `${NS.officeRel}/${kind}`, `${kind}1.xml`);
        let sect = sectPrOf(body);
        if (!sect) {
          sect = doc.createElementNS(W, "w:sectPr");
          body.appendChild(sect);
        }
        const tag = `${kind}Reference`;
        let reference = Array.from(sect.childNodes).find((n) => (n as XElement).localName === tag) as XElement | undefined;
        if (!reference) {
          reference = doc.createElementNS(W, `w:${tag}`);
          sect.insertBefore(reference, sect.firstChild);
        }
        reference.setAttributeNS(W, "w:type", "default");
        reference.setAttributeNS(NS.officeRel, "r:id", relId);
        await ensureContentType(safe, `/${part}`, kind === "header" ? CONTENT_TYPE_HEADER : CONTENT_TYPE_FOOTER);
        report.applied.push(op.op);
        break;
      }
      case "setSection": {
        let sect = sectPrOf(body);
        if (!sect) {
          sect = doc.createElementNS(W, "w:sectPr");
          body.appendChild(sect);
        }
        applySection(sect, op.section);
        report.applied.push("setSection");
        break;
      }
    }
  }

  const updated = serialize(doc);
  await assertWellFormed(updated, "document.xml editado");
  putText(safe, ZIP_PART.docxDocument, updated);
  await assertRelationshipsResolvable(safe);
  return { bytes: await zipBytes(safe), report };
}
