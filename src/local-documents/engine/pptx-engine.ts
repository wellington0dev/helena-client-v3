/**
 * Inspeção PPTX sem dependência extra: lê o OOXML diretamente do pacote.
 * Não há renderizador visual (LibreOffice/soffice não existe neste ambiente),
 * então a prévia é explicitamente marcada como estrutural — nunca apresentada
 * como fidelidade visual.
 */
import type { InspectPresentationResult, SlideInfo } from "./contracts.ts";
import { assertRelationshipsResolvable, assertWellFormed, escapeXml, loadSafeZip, NS, readText, type SafeZip } from "./ooxml.ts";

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]+)"`).exec(tag)?.[1];
}

function decode(value: string | undefined): string {
  return (value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function slideNumbers(safe: SafeZip): number[] {
  return [...safe.names]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .map((name) => Number(/slide(\d+)\.xml/.exec(name)![1]))
    .sort((a, b) => a - b);
}

async function slideRels(safe: SafeZip, index: number): Promise<string> {
  const path = `ppt/slides/_rels/slide${index}.xml.rels`;
  return safe.names.has(path) ? readText(safe, path) : "";
}

export async function inspectPptx(bytes: Buffer): Promise<InspectPresentationResult> {
  const safe = await loadSafeZip(bytes);
  const presentation = await readText(safe, "ppt/presentation.xml");
  await assertWellFormed(presentation, "presentation.xml");
  const slideSizeTag = /<p:sldSz\b[^>]*\/>/.exec(presentation)?.[0];
  const width = slideSizeTag ? Number(attr(slideSizeTag, "cx")) : undefined;
  const height = slideSizeTag ? Number(attr(slideSizeTag, "cy")) : undefined;
  const declaredCount = (presentation.match(/<p:sldId\b/g) ?? []).length;
  const numbers = slideNumbers(safe);
  const slides: SlideInfo[] = [];

  for (const index of numbers) {
    const xml = await readText(safe, `ppt/slides/slide${index}.xml`);
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => decode(match[1]!)).filter(Boolean);
    const rels = await slideRels(safe, index);
    const imageCount = (rels.match(/relationships\/image"/g) ?? []).length;
    const chartCount = (rels.match(/relationships\/chart"/g) ?? []).length;
    const notesPath = `ppt/notesSlides/notesSlide${index}.xml`;
    const notes = safe.names.has(notesPath)
      ? [...(await readText(safe, notesPath)).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decode(m[1]!)).join(" ").slice(0, 500)
      : undefined;
    slides.push({
      index,
      title: texts[0]?.slice(0, 160),
      texts: texts.slice(0, 60),
      imageCount,
      tableCount: (xml.match(/<a:tbl>/g) ?? []).length,
      chartCount,
      ...(notes && { notes }),
    });
  }
  await assertRelationshipsResolvable(safe);
  return {
    slideCount: Math.max(declaredCount, slides.length),
    ...(width && { width }),
    ...(height && { height }),
    slides,
    previewFidelity: "structural",
    previewNote: "Metadados e textos extraídos do OOXML. Prévia visual fiel exige renderizador (LibreOffice headless), indisponível neste ambiente.",
  };
}

export async function readPptxText(bytes: Buffer, slide?: number): Promise<{ text: string; truncated: boolean }> {
  const info = await inspectPptx(bytes);
  const selected = slide ? info.slides.filter((s) => s.index === slide) : info.slides;
  const lines = selected.flatMap((s) => [
    `Slide ${s.index}:`,
    ...s.texts.map((t) => `  ${t}`),
    ...(s.notes ? [`  [Notas] ${s.notes}`] : []),
    "",
  ]);
  const text = lines.join("\n");
  if (text.length <= 60_000) return { text, truncated: false };
  return { text: `${text.slice(0, 60_000)}\n\n[Apresentação truncada para caber no contexto.]`, truncated: true };
}

/** HTML estrutural: caixas de texto e contadores por slide, sem fingir fidelidade. */
export async function renderPptxHtml(bytes: Buffer, selectedSlide?: number): Promise<string> {
  const info = await inspectPptx(bytes);
  const ratio = info.width && info.height ? info.width / info.height : 16 / 9;
  return info.slides
    .filter((slide) => selectedSlide === undefined || slide.index === selectedSlide)
    .map((slide) => {
      const body = slide.texts.map((text) => `<p>${escapeXml(text)}</p>`).join("");
      const meta = `${slide.imageCount} imagem(ns), ${slide.tableCount} tabela(s), ${slide.chartCount} gráfico(s)`;
      return `<section class="slide" style="aspect-ratio:${ratio.toFixed(3)}"><header>Slide ${slide.index}${slide.title ? ` — ${escapeXml(slide.title)}` : ""}</header><div>${body || "<p>[Sem texto selecionável]</p>"}</div><footer>${meta}</footer></section>`;
    })
    .join("");
}

/** Exportação PPTX→PDF depende de renderizador externo; exposta como capacidade ausente. */
export class PptxExportUnavailableError extends Error {
  constructor() {
    super("Exportação PPTX→PDF requer LibreOffice headless, que não está instalado. Instale um renderizador autorizado para habilitar esta capacidade.");
    this.name = "PptxExportUnavailableError";
  }
}
