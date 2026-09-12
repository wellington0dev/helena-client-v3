import fs from "fs";
import path from "path";
import { expandHome } from "./local-shell.ts";

/**
 * Capacidades `list_files`/`read_file`/`search_files`/`write_file` — Fase 0
 * do plano de agentes de dev (backend-v2 `docs/agent-team-architecture.md`
 * §1.2). Mesmo protocolo genérico de `exec`/`exec-result` que `shell` já
 * usa (`agent-protocol.ts` não amarra `capability` a um valor fixo) — só
 * capabilities e payloads novos, nenhuma mensagem nova.
 *
 * Edição estruturada por linha (não heredoc via shell) — evita reabrir a
 * superfície de "string de comando interpretada" que `shell.ts` já aceita
 * conscientemente só pra comando de terminal de verdade.
 */

const IGNORED_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build", ".next", ".cache", "coverage"]);
/** Arquivo de código nunca deveria passar disso — evita carregar um binário gigante na memória sem querer. */
const MAX_READ_BYTES = 2 * 1024 * 1024;
/** Teto de resultados de busca — evita devolver uma lista gigante (ou nunca terminar de escanear um projeto enorme). */
const MAX_SEARCH_RESULTS = 500;

function resolvePath(target: string): string {
    return expandHome(target) ?? target;
}

function describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function safeRegex(pattern: string): RegExp | undefined {
    try {
        return new RegExp(pattern);
    } catch {
        return undefined;
    }
}

function formatMb(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(1);
}

export interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
}

export interface ListFilesResult {
    files: FileEntry[];
    error?: string;
}

/** `pattern` é regex sobre o NOME (não glob) — mesma convenção de `namePattern` em `searchFiles`, só uma forma de casar em todo o módulo. */
export function listFiles(dirPath: string, pattern?: string): ListFilesResult {
    const resolved = resolvePath(dirPath);

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(resolved, { withFileTypes: true });
    } catch (err) {
        return { files: [], error: `Não consegui listar "${dirPath}": ${describe(err)}` };
    }

    const regex = pattern ? safeRegex(pattern) : undefined;
    if (pattern && !regex) return { files: [], error: `Padrão de nome inválido: "${pattern}"` };

    const files = entries
        .filter((entry) => !regex || regex.test(entry.name))
        .map((entry) => {
            const fullPath = path.join(resolved, entry.name);
            let size = 0;
            try {
                size = fs.statSync(fullPath).size;
            } catch {
                // Arquivo pode ter sumido entre o readdir e o stat (raro, ex: link simbólico quebrado) — 0 é aceitável, nunca derruba a listagem inteira por isso.
            }
            return { name: entry.name, path: fullPath, isDirectory: entry.isDirectory(), size };
        });

    return { files };
}

export interface ReadFileResult {
    content: string;
    error?: string;
}

export function readFile(filePath: string): ReadFileResult {
    const resolved = resolvePath(filePath);

    let stat: fs.Stats;
    try {
        stat = fs.statSync(resolved);
    } catch (err) {
        return { content: "", error: `Não consegui ler "${filePath}": ${describe(err)}` };
    }

    if (stat.isDirectory()) return { content: "", error: `"${filePath}" é um diretório, não um arquivo.` };
    if (stat.size > MAX_READ_BYTES) return { content: "", error: `arquivo tem ${formatMb(stat.size)} MB, limite pra leitura é ${formatMb(MAX_READ_BYTES)} MB.` };

    try {
        return { content: fs.readFileSync(resolved, "utf8") };
    } catch (err) {
        return { content: "", error: `Não consegui ler "${filePath}": ${describe(err)}` };
    }
}

export interface SearchFilesResult {
    paths: string[];
    error?: string;
}

function walk(dir: string, nameRegex: RegExp | undefined, contentRegex: RegExp | undefined, results: string[]): void {
    if (results.length >= MAX_SEARCH_RESULTS) return;

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return; // Diretório sem permissão/removido no meio da busca — ignora, não derruba a busca inteira.
    }

    for (const entry of entries) {
        if (results.length >= MAX_SEARCH_RESULTS) return;

        if (entry.isDirectory()) {
            if (IGNORED_DIR_NAMES.has(entry.name)) continue;
            walk(path.join(dir, entry.name), nameRegex, contentRegex, results);
            continue;
        }

        if (nameRegex && !nameRegex.test(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        if (contentRegex) {
            let content: string;
            try {
                content = fs.readFileSync(fullPath, "utf8");
            } catch {
                continue; // binário/sem permissão de leitura — nunca é candidato de busca por conteúdo.
            }
            if (!contentRegex.test(content)) continue;
        }

        results.push(fullPath);
    }
}

export function searchFiles(dirPath: string, namePattern?: string, contentPattern?: string): SearchFilesResult {
    if (!namePattern && !contentPattern) return { paths: [], error: "Informe namePattern e/ou contentPattern." };

    const nameRegex = namePattern ? safeRegex(namePattern) : undefined;
    if (namePattern && !nameRegex) return { paths: [], error: `Padrão de nome inválido: "${namePattern}"` };

    const contentRegex = contentPattern ? safeRegex(contentPattern) : undefined;
    if (contentPattern && !contentRegex) return { paths: [], error: `Padrão de conteúdo inválido: "${contentPattern}"` };

    const results: string[] = [];
    walk(resolvePath(dirPath), nameRegex, contentRegex, results);
    return { paths: results };
}

/**
 * `startLine`/`endLine` são 1-indexados e sempre se referem ao arquivo
 * ORIGINAL (antes de qualquer edit deste mesmo pedido) — ver doc do tipo
 * espelhado em backend-v2 `machines.service.ts#FileEdit`. A ORDEM deste
 * array nunca importa: `writeFile` sempre aplica de baixo pra cima.
 */
export type FileEdit = { type: "add"; startLine: number; content: string } | { type: "remove"; startLine: number; endLine: number } | { type: "replace_all"; content: string };

export interface WriteFileResult {
    ok: boolean;
    bytesWritten?: number;
    error?: string;
}

function editPosition(edit: FileEdit): number {
    return edit.type === "replace_all" ? 0 : edit.startLine;
}

function writeWhole(resolvedPath: string, originalPath: string, content: string): WriteFileResult {
    try {
        // Diretório-pai pode não existir ainda (ex: criar um arquivo numa pasta nova) — mesmo tratamento do file-transfer legado.
        fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
        fs.writeFileSync(resolvedPath, content, "utf8");
        return { ok: true, bytesWritten: Buffer.byteLength(content, "utf8") };
    } catch (err) {
        return { ok: false, error: `Não consegui escrever em "${originalPath}": ${describe(err)}` };
    }
}

export function writeFile(filePath: string, edits: FileEdit[]): WriteFileResult {
    if (edits.length === 0) return { ok: false, error: "Nenhuma edição informada." };

    const replaceAll = edits.find((edit) => edit.type === "replace_all");
    if (replaceAll) {
        if (edits.length > 1) return { ok: false, error: "replace_all não pode ser combinado com outras edições." };
        return writeWhole(resolvePath(filePath), filePath, replaceAll.content);
    }

    const resolved = resolvePath(filePath);
    let original: string;
    try {
        original = fs.readFileSync(resolved, "utf8");
    } catch (err) {
        // Arquivo pode não existir ainda — só é aceitável se todos os edits forem "add" (criando do zero); "remove" num arquivo inexistente é erro real.
        if (edits.some((edit) => edit.type === "remove")) return { ok: false, error: `Não consegui ler "${filePath}" pra aplicar as edições: ${describe(err)}` };
        original = "";
    }

    const lines = original.split("\n");
    // Ordena por posição DECRESCENTE (maior linha primeiro) — aplicar de baixo pra cima preserva os números de linha dos edits acima, que sempre se referem ao arquivo ORIGINAL.
    const ordered = [...edits].sort((a, b) => editPosition(b) - editPosition(a));

    for (const edit of ordered) {
        if (edit.type === "add") {
            const insertAt = Math.max(0, Math.min(lines.length, edit.startLine - 1));
            lines.splice(insertAt, 0, ...edit.content.split("\n"));
        } else if (edit.type === "remove") {
            const start = Math.max(0, edit.startLine - 1);
            const count = Math.max(0, edit.endLine - edit.startLine + 1);
            lines.splice(start, count);
        }
    }

    return writeWhole(resolved, filePath, lines.join("\n"));
}

export interface DeleteFileResult {
    ok: boolean;
    error?: string;
}

/**
 * Capability nova, só pra `undo_last_write` (backend-v2
 * dev-team-write.tools.ts) desfazer um `write_file` que CRIOU um arquivo
 * novo (sem pré-imagem pra restaurar, a única saída é apagar) — nunca
 * exposta como tool solta pro modelo, de propósito: um `delete_file`
 * genérico dado direto ao agente de dev seria uma superfície de risco à
 * toa que ninguém pediu.
 */
export function deleteFile(filePath: string): DeleteFileResult {
    const resolved = resolvePath(filePath);
    try {
        fs.unlinkSync(resolved);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: `Não consegui apagar "${filePath}": ${describe(err)}` };
    }
}
