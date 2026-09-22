import fs from "node:fs";
import path from "node:path";
import stringWidth from "string-width";

/**
 * Utilidades compartilhadas entre `file-mentions.ts` (autocompletar `@arquivo`) e a sidebar de sessões do chat
 * (`app.ts`) — nomes a ignorar em listagens de diretório e truncamento de texto pra caber numa coluna fixa do
 * terminal. Até 2026-09-22 este arquivo também desenhava a ÁRVORE de arquivos da sidebar (`readWorktree`/
 * `renderWorktreeLines`, removidas — a sidebar virou uma lista de sessões clicável, pedido do dono).
 */

/** Nunca vale a pena listar — gigantes/gerados (o dono os ignora no git também). */
const IGNORED = new Set([".git", ".angular", "node_modules", "dist", "build", ".next", ".cache", "__pycache__", ".venv", "venv", "coverage", ".turbo", ".DS_Store"]);

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
