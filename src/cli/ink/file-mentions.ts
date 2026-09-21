import fs from "node:fs";
import path from "node:path";
import { ignoredNames } from "./worktree.ts";

/**
 * Autocomplete de `@arquivo` no composer. Três peças puras/quase puras:
 *  - `listProjectFiles`: índice de caminhos relativos do diretório aberto (ignora node_modules/.git/dist + .gitignore);
 *  - `findMentionToken`: acha o `@trecho` no FIM do texto digitado (o cursor do ink-text-input fica sempre no fim);
 *  - `matchFiles`/`applyMention`: filtra/ordena e devolve o texto com o caminho completado.
 */

const MAX_FILES = 5000;
const MAX_DEPTH = 8;

export function listProjectFiles(root: string): string[] {
    const ignored = ignoredNames(root);
    const out: string[] = [];
    const walk = (dir: string, rel: string, depth: number): void => {
        if (out.length >= MAX_FILES) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (out.length >= MAX_FILES) return;
            if (ignored.has(entry.name)) continue;
            const relPath = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (depth + 1 < MAX_DEPTH) walk(path.join(dir, entry.name), relPath, depth + 1);
            } else {
                out.push(relPath);
            }
        }
    };
    walk(root, "", 0);
    return out;
}

export interface MentionToken {
    /** Índice do "@" em `value`. */
    start: number;
    /** Texto depois do "@" (pode ser vazio). */
    query: string;
}

/** O "@" só conta no começo do texto ou depois de espaço (senão "email@dominio" viraria menção). */
export function findMentionToken(value: string): MentionToken | undefined {
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    if (!match) return undefined;
    const query = match[1] ?? "";
    return { start: value.length - query.length - 1, query };
}

export function matchFiles(files: string[], query: string, limit = 8): string[] {
    const q = query.toLowerCase();
    if (q === "") {
        // sem filtro: arquivos mais rasos primeiro (o que costuma interessar: README, package.json, src/...)
        return [...files].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)).slice(0, limit);
    }
    const scored: { file: string; score: number }[] = [];
    for (const file of files) {
        const lower = file.toLowerCase();
        const idx = lower.indexOf(q);
        if (idx === -1) continue;
        const base = lower.slice(lower.lastIndexOf("/") + 1);
        // menor = melhor: nome começando com o termo > nome contendo > caminho contendo; depois o mais curto
        const score = (base.startsWith(q) ? 0 : base.includes(q) ? 1000 : 2000) + lower.length;
        scored.push({ file, score });
    }
    return scored.sort((a, b) => a.score - b.score || a.file.localeCompare(b.file)).slice(0, limit).map((s) => s.file);
}

export function applyMention(value: string, token: MentionToken, file: string): string {
    return `${value.slice(0, token.start)}@${file} `;
}
