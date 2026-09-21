import fs from "node:fs";
import path from "node:path";
import { configDir } from "../../local-api/paths.ts";

/**
 * Histórico do input do chat (↑/↓ recuperam mensagens anteriores, como no shell). Guardado em
 * `<configDir>/input-history.json` (0600 — são mensagens suas) pra sobreviver entre sessões do `helena`.
 * A navegação é pura (`olderEntry`/`newerEntry`) e testada em input-history.test.ts; a persistência
 * nunca lança (histórico é conveniência, não pode derrubar o chat).
 */

export const MAX_INPUT_HISTORY = 200;

export function inputHistoryFile(): string {
    return path.join(configDir(), "input-history.json");
}

/** Mais antiga → mais nova. */
export function loadInputHistory(file = inputHistoryFile()): string[] {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").slice(-MAX_INPUT_HISTORY);
    } catch {
        return [];
    }
}

/** Acrescenta `text` (sem repetir a última entrada), respeita o teto e grava. Devolve a lista nova. */
export function appendInputHistory(entries: string[], text: string, file = inputHistoryFile()): string[] {
    const trimmed = text.trim();
    if (!trimmed || entries[entries.length - 1] === trimmed) return entries;
    const next = [...entries, trimmed].slice(-MAX_INPUT_HISTORY);
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(tmp, file);
    } catch {
        // sem permissão / disco cheio — a sessão atual continua com o histórico em memória
    }
    return next;
}

/** `index` = posição em `entries` da entrada mostrada agora; `null` = digitando normalmente (fora do histórico). */
export interface HistoryNav {
    index: number | null;
    /** O que estava sendo digitado antes de começar a navegar — volta ao apertar ↓ além da entrada mais nova. */
    draft: string;
}

export const NOT_NAVIGATING: HistoryNav = { index: null, draft: "" };

export function olderEntry(entries: string[], nav: HistoryNav, current: string): { value: string; nav: HistoryNav } | undefined {
    if (entries.length === 0) return undefined;
    if (nav.index === null) return { value: entries[entries.length - 1]!, nav: { index: entries.length - 1, draft: current } };
    if (nav.index === 0) return undefined; // já na mais antiga
    return { value: entries[nav.index - 1]!, nav: { ...nav, index: nav.index - 1 } };
}

export function newerEntry(entries: string[], nav: HistoryNav): { value: string; nav: HistoryNav } | undefined {
    if (nav.index === null) return undefined;
    if (nav.index >= entries.length - 1) return { value: nav.draft, nav: NOT_NAVIGATING };
    return { value: entries[nav.index + 1]!, nav: { ...nav, index: nav.index + 1 } };
}
