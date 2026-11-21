/**
 * Helpers OOXML de baixo nível usados pela Document Engine. Nenhuma função
 * aqui executa código de documentos: elas apenas leem/escrevem pacotes ZIP,
 * validam XML e manipulam relacionamentos — com limites explícitos para
 * evitar ZIP bombs e esgotamento de recursos.
 */
import JSZip from "jszip";
import { SaxesParser } from "saxes";

export const NS = {
  spreadsheet: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  wordprocessing: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  drawing: "http://schemas.openxmlformats.org/drawingml/2006/main",
  chart: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  officeRel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  packageRel: "http://schemas.openxmlformats.org/package/2006/relationships",
  contentTypes: "http://schemas.openxmlformats.org/package/2006/content-types",
  presentation: "http://schemas.openxmlformats.org/presentationml/2006/main",
} as const;

export const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRIES = 4_000;
export const MAX_XML_BYTES = 32 * 1024 * 1024;

export class DocumentValidationError extends Error {
  readonly code: string;
  constructor(message: string, code: string = "INVALID_DOCUMENT") {
    super(message);
    this.code = code;
    this.name = "DocumentValidationError";
  }
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    // XML 1.0 não aceita caracteres de controle C0 exceto tab/CR/LF.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Valida que um XML está bem formado. Não resolve entidades externas (saxes não o faz). */
export async function assertWellFormed(xml: string, label: string): Promise<void> {
  if (Buffer.byteLength(xml, "utf8") > MAX_XML_BYTES) {
    throw new DocumentValidationError(`XML ${label} excede o limite de tamanho.`, "XML_TOO_LARGE");
  }
  await new Promise<void>((resolve, reject) => {
    const parser = new SaxesParser();
    let failure: Error | undefined;
    parser.on("error", (error) => {
      failure = error;
    });
    try {
      parser.write(xml);
      parser.close();
    } catch (error) {
      failure = error as Error;
    }
    if (failure) {
      reject(new DocumentValidationError(`XML ${label} inválido: ${failure.message}`, "MALFORMED_XML"));
    } else {
      resolve();
    }
  });
}

export interface SafeZip {
  zip: JSZip;
  names: Set<string>;
}

/** Carrega um pacote OOXML com limites contra ZIP bombs e paths suspeitos. */
export async function loadSafeZip(bytes: Buffer | Uint8Array): Promise<SafeZip> {
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const names = new Set<string>();
  let total = 0;
  let entries = 0;
  for (const [name, entry] of Object.entries(zip.files)) {
    entries += 1;
    if (entries > MAX_ENTRIES) throw new DocumentValidationError("Pacote com entradas excessivas.", "TOO_MANY_ENTRIES");
    // JSZip normaliza `../x` para `x` no campo `name`, mas preserva o original
    // em `unsafeOriginalName` — é nele que a travessia precisa ser detectada.
    const originalName = (entry as JSZip.JSZipObject & { unsafeOriginalName?: string }).unsafeOriginalName ?? name;
    if (originalName.includes("\\") || originalName.split("/").some((part) => part === "..")) {
      throw new DocumentValidationError("Pacote contém caminho inválido.", "UNSAFE_PATH");
    }
    if (entry.dir) continue;
    // JSZip não expõe o tamanho descomprimido nos tipos públicos (`_data` é
    // privado). Usamos o tamanho comprimido como aproximação para o limite
    // rápido e, em seguida,validamos cada parte ao lê-la em `readText`.
    total += (entry as JSZip.JSZipObject & { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new DocumentValidationError("Pacote excede o tamanho não comprimido permitido.", "ZIP_BOMB");
    }
    names.add(name);
  }
  return { zip, names };
}

export async function zipBytes(safe: SafeZip, compression: "DEFLATE" | "STORE" = "DEFLATE"): Promise<Buffer> {
  return Buffer.from(await safe.zip.generateAsync({ type: "nodebuffer", compression, compressionOptions: { level: 6 } }));
}

export async function readText(safe: SafeZip, name: string): Promise<string> {
  const entry = safe.zip.file(name);
  if (!entry) throw new DocumentValidationError(`Parte obrigatória ausente: ${name}`, "MISSING_PART");
  const bytes = await entry.async("nodebuffer");
  if (bytes.byteLength > MAX_XML_BYTES) throw new DocumentValidationError(`Parte ${name} muito grande.`, "PART_TOO_LARGE");
  return bytes.toString("utf8");
}

export function putText(safe: SafeZip, name: string, content: string): void {
  safe.zip.file(name, content);
  safe.names.add(name);
}

/** Garante que um tipo MIME aparece como Override em [Content_Types].xml. */
export async function ensureContentType(safe: SafeZip, partName: string, contentType: string): Promise<void> {
  const path = "[Content_Types].xml";
  const xml = await readText(safe, path);
  const escaped = escapeXml(partName);
  const already = xml.includes(`PartName="${escaped}"`) || xml.includes(`PartName="${partName}"`);
  if (!already) {
    const override = `<Override PartName="${escaped}" ContentType="${escapeXml(contentType)}"/>`;
    const updated = xml.replace(/<\/Types>\s*$/, `${override}</Types>`);
    putText(safe, path, updated);
  }
}

/**
 * Adiciona uma relationship a um arquivo .rels, criando-o se necessário.
 * `targetMode="External"` é usado apenas para hiperlinks; referências internas
 * de documento nunca são externas, evitando SSRF por hiperlinks em OOXML.
 */
export async function addRelationship(
  safe: SafeZip,
  relsPath: string,
  type: string,
  target: string,
  external = false,
): Promise<string> {
  const existing = safe.zip.file(relsPath) ? await readText(safe, relsPath) : EMPTY_RELS;
  const matches = [...existing.matchAll(/Id="(rId\d+)"/g)];
  const max = matches.reduce((acc, match) => Math.max(acc, Number(match[1]!.slice(3))), 0);
  const id = `rId${max + 1}`;
  const rel = `<Relationship Id="${id}" Type="${type}" Target="${escapeXml(target)}"${external ? ' TargetMode="External"' : ""}/>`;
  const updated = existing.replace(/<\/Relationships>\s*$/, `${rel}</Relationships>`);
  putText(safe, relsPath, updated);
  return id;
}

const EMPTY_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${NS.packageRel}"></Relationships>`;

/** Verifica que todas as relationships internas apontam para partes existentes. */
export async function assertRelationshipsResolvable(safe: SafeZip): Promise<void> {
  for (const name of [...safe.names]) {
    if (!name.endsWith(".rels")) continue;
    const xml = await readText(safe, name);
    // A base de um arquivo .rels é o diretório do documento relacionado,
    // não o diretório `_rels` onde o próprio arquivo vive.
    const rawDir = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
    const sourceDir = rawDir.replace(/_rels\/$/, "");
    for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
      const tag = match[0];
      if (/TargetMode="External"/.test(tag)) continue;
      const target = /Target="([^"]+)"/.exec(tag)?.[1];
      if (!target || target.startsWith("/")) continue;
      const resolved = normalizeZipPath(`${sourceDir}${target}`);
      if (!safe.names.has(resolved)) {
        throw new DocumentValidationError(`Relationship quebrada em ${name}: ${target}`, "BROKEN_RELATIONSHIP");
      }
    }
  }
}

export function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length) parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/** Detecta assinaturas de formatos para não confiar só na extensão. */
export function detectOfficeFormat(bytes: Buffer): "ooxml" | "pdf" | "unknown" {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return "ooxml";
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return "unknown";
}

export const ZIP_PART = {
  docxDocument: "word/document.xml",
  docxStyles: "word/styles.xml",
  contentTypes: "[Content_Types].xml",
  workbook: "xl/workbook.xml",
  docPropsApp: "docProps/app.xml",
} as const;
