import fs from "node:fs";
import path from "node:path";
import { configDir } from "../../local-api/paths.ts";

/**
 * Preferências LOCAIS da CLI (só desta máquina, ex: sidebar ligada) — `<configDir>/cli-prefs.json`, 0600. Separado do
 * `config.json` de propósito: aquele é do Config Store do daemon (canais/máquina) e tem dono e schema próprios.
 * Preferências da CONTA (telemetria, auto-approve...) moram no backend, não aqui. Nunca lança.
 */
export interface CliPrefs {
    /** Sidebar de sessões ligada. Ausente = padrão (ligada). */
    sidebar?: boolean;
}

export function cliPrefsFile(): string {
    return path.join(configDir(), "cli-prefs.json");
}

export function loadCliPrefs(file = cliPrefsFile()): CliPrefs {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        if (!parsed || typeof parsed !== "object") return {};
        const prefs: CliPrefs = {};
        if (typeof (parsed as CliPrefs).sidebar === "boolean") prefs.sidebar = (parsed as CliPrefs).sidebar;
        return prefs;
    } catch {
        return {};
    }
}

/** Mescla `patch` no arquivo (gravação atômica). Devolve as prefs resultantes. */
export function saveCliPrefs(patch: CliPrefs, file = cliPrefsFile()): CliPrefs {
    const next = { ...loadCliPrefs(file), ...patch };
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
        fs.renameSync(tmp, file);
    } catch {
        // sem permissão/disco cheio: vale só nesta sessão
    }
    return next;
}
