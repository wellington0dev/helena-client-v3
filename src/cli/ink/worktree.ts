import fs from "node:fs";
import path from "node:path";
import stringWidth from "string-width";

/**
 * Worktree da sidebar do chat (árvore de arquivos do diretório onde `helena`
 * foi chamado). Separado em leitura (`readWorktree`, toca o disco) e
 * renderização (`renderWorktreeLines`, pura) — a segunda é o que
 * worktree.test.ts cobre. Cada linha renderizada tem, por construção,
 * largura <= `width` e ocupa EXATAMENTE uma linha do terminal: a sidebar tem
 * altura fixa e não pode quebrar linha (ver app.ts, que orça as colunas do
 * chat descontando a largura da sidebar).
 */

export interface WorktreeEntry {
    name: string;
    depth: number;
    isDir: boolean;
}

/** Nunca vale a pena listar — gigantes/gerados (o dono os ignora no git também). */
const IGNORED = new Set([".git", ".angular", "node_modules", "dist", "build", ".next", ".cache", "__pycache__", ".venv", "venv", "coverage", ".turbo", ".DS_Store"]);

const MAX_DEPTH = 3;
const MAX_ENTRIES_PER_DIR = 40;
const MAX_TOTAL_ENTRIES = 400;

/**
 * Nomes simples do `.gitignore` da RAIZ aberta (ex: `out/`, `/tmp`, `.env`) — sem glob/negação, de propósito:
 * é só pra a árvore não mostrar o que o projeto já declara como lixo. Padrão com `*`, `!` ou subpasta é ignorado aqui.
 */
export function readGitignoreNames(root: string): Set<string> {
    const names = new Set<string>();
    let text = "";
    try {
        text = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    } catch {
        return names;
    }
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#") || line.startsWith("!") || /[*?[\]]/.test(line)) continue;
        const name = line.replace(/^\//, "").replace(/\/$/, "");
        if (name && !name.includes("/")) names.add(name);
    }
    return names;
}

/** Nomes que nunca entram em listagens (fixos + nomes simples do .gitignore da raiz) — compartilhado com file-mentions.ts. */
export function ignoredNames(root: string): Set<string> {
    return new Set([...IGNORED, ...readGitignoreNames(root)]);
}

export function readWorktree(root: string, maxDepth = MAX_DEPTH): WorktreeEntry[] {
    const ignored = ignoredNames(root);
    const out: WorktreeEntry[] = [];
    const walk = (dir: string, depth: number): void => {
        if (out.length >= MAX_TOTAL_ENTRIES) return;
        let names: fs.Dirent[];
        try {
            names = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return; // sem permissão / sumiu no meio — sidebar nunca derruba o chat
        }
        const entries = names
            .filter((d) => !ignored.has(d.name))
            // pastas primeiro, depois arquivos; ordem alfabética estável dentro de cada grupo
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
        for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIR)) {
            if (out.length >= MAX_TOTAL_ENTRIES) return;
            const isDir = entry.isDirectory();
            out.push({ name: entry.name, depth, isDir });
            if (isDir && depth + 1 < maxDepth) walk(path.join(dir, entry.name), depth + 1);
        }
        if (entries.length > MAX_ENTRIES_PER_DIR) out.push({ name: `… +${entries.length - MAX_ENTRIES_PER_DIR}`, depth, isDir: false });
    };
    walk(root, 0);
    return out;
}

/** Corta em `width` colunas visíveis, terminando com "…" quando cortou. */
export function truncateToWidth(text: string, width: number): string {
    if (width <= 0) return "";
    if (stringWidth(text) <= width) return text;
    let acc = "";
    for (const ch of text) {
        if (stringWidth(acc + ch) > width - 1) break;
        acc += ch;
    }
    return acc + "…";
}

/**
 * Desenha as entradas como árvore (`├─`/`└─`, `▸` em pasta). `maxLines` é o
 * orçamento de linhas da sidebar; se a árvore não cabe, a última linha vira
 * "… +N" com o quanto ficou de fora.
 */
export function renderWorktreeLines(entries: WorktreeEntry[], width: number, maxLines: number): string[] {
    if (maxLines <= 0) return [];
    const lines: string[] = [];
    entries.forEach((entry, i) => {
        // último irmão = próxima entrada de profundidade <= a dele é mais rasa (ou não há próxima)
        let isLast = true;
        for (let j = i + 1; j < entries.length; j++) {
            if (entries[j]!.depth < entry.depth) break;
            if (entries[j]!.depth === entry.depth) {
                isLast = false;
                break;
            }
        }
        const indent = "  ".repeat(Math.max(0, entry.depth));
        const branch = isLast ? "└─ " : "├─ ";
        const label = entry.isDir ? `▸ ${entry.name}/` : entry.name;
        lines.push(truncateToWidth(indent + branch + label, width));
    });
    if (lines.length <= maxLines) return lines;
    const hidden = lines.length - (maxLines - 1);
    return [...lines.slice(0, maxLines - 1), truncateToWidth(`… +${hidden} itens`, width)];
}
