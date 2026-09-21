import fs from "node:fs";
import path from "node:path";
import { configDir } from "./paths.ts";

/**
 * Configuração LOCAL desta máquina, num só lugar: `~/.config/helena/config.json` (0600), escrita só pela API
 * (`PATCH /v1/config`) com validação. Precedência: config.json > .env > padrões (o `.env` continua sendo lido
 * como fallback por uma versão). Segredos (token do bot do Telegram) são write-only: nunca voltam em GET.
 * Preferências que valem pra TODOS os dispositivos do usuário (telemetria, auto-approve, mensagens proativas)
 * continuam no BACKEND e são acessadas pelo proxy — não moram aqui.
 */
export interface FileConfig {
    backendUrl?: string;
    machineName?: string;
    allowedDirs?: string[];
    deniedPaths?: string[];
    backgroundShellTimeoutMinutes?: number;
    mediaMaxMb?: number;
    telegramBotToken?: string;
}

type Key = keyof FileConfig;
const SECRET_KEYS: readonly Key[] = ["telegramBotToken"];
/** Chaves cuja mudança só vale depois de reiniciar o daemon (ou o canal correspondente). */
const RESTART_KEYS: readonly Key[] = ["backendUrl", "machineName"];

const validators: Record<Key, (v: unknown) => string | undefined> = {
    backendUrl: (v) => (typeof v === "string" && /^https?:\/\/[^\s/]+/.test(v) ? undefined : "deve ser uma URL http(s)"),
    machineName: (v) => (typeof v === "string" && v.trim().length >= 1 && v.length <= 100 ? undefined : "texto de 1 a 100 caracteres"),
    allowedDirs: (v) => (Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === "string" && path.isAbsolute(x.replace(/^~(?=$|\/)/, "/home"))) ? undefined : "lista de até 50 caminhos absolutos (ou começando com ~)"),
    deniedPaths: (v) => (Array.isArray(v) && v.length <= 100 && v.every((x) => typeof x === "string" && x.length > 0) ? undefined : "lista de até 100 caminhos"),
    backgroundShellTimeoutMinutes: (v) => (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 720 ? undefined : "número entre 1 e 720"),
    mediaMaxMb: (v) => (typeof v === "number" && Number.isFinite(v) && v >= 1 && v <= 200 ? undefined : "número entre 1 e 200"),
    telegramBotToken: (v) => (typeof v === "string" && /^\d+:[A-Za-z0-9_-]{20,}$/.test(v) ? undefined : "formato de token de bot do Telegram inválido"),
};

export function configFilePath(): string {
    return path.join(configDir(), "config.json");
}

export function loadFileConfig(): FileConfig {
    try {
        const parsed = JSON.parse(fs.readFileSync(configFilePath(), "utf8")) as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(validators) as Key[]) {
            if (key in parsed && validators[key](parsed[key]) === undefined) out[key] = parsed[key];
        }
        return out as FileConfig;
    } catch {
        return {};
    }
}

function saveFileConfig(cfg: FileConfig): void {
    const file = configFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
}

/** Visão pública: segredos viram `<chave>Set: boolean`. */
export function publicView(cfg: FileConfig): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(cfg)) {
        if ((SECRET_KEYS as readonly string[]).includes(key)) out[`${key}Set`] = Boolean(value);
        else out[key] = value;
    }
    for (const key of SECRET_KEYS) if (!(`${key}Set` in out)) out[`${key}Set`] = false;
    return out;
}

export type PatchResult = { ok: true; config: FileConfig; changed: string[]; restartRequired: string[] } | { ok: false; errors: Record<string, string> };

/** `null` remove a chave. Chave desconhecida ou valor inválido recusa o PATCH inteiro (nada é gravado). */
export function patchFileConfig(patch: Record<string, unknown>): PatchResult {
    const errors: Record<string, string> = {};
    const current = loadFileConfig();
    const next: Record<string, unknown> = { ...current };
    const changed: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
        if (!(key in validators)) {
            errors[key] = "chave desconhecida";
            continue;
        }
        if (value === null) {
            if (key in next) {
                delete next[key];
                changed.push(key);
            }
            continue;
        }
        const problem = validators[key as Key](value);
        if (problem) {
            errors[key] = problem;
            continue;
        }
        if (JSON.stringify(next[key]) !== JSON.stringify(value)) {
            next[key] = value;
            changed.push(key);
        }
    }
    if (Object.keys(errors).length > 0) return { ok: false, errors };
    if (changed.length > 0) saveFileConfig(next as FileConfig);
    return { ok: true, config: next as FileConfig, changed, restartRequired: changed.filter((k) => (RESTART_KEYS as readonly string[]).includes(k)) };
}

/** Importação ÚNICA do `.env` (só se o config.json ainda não existe): copia o que estiver definido no ambiente. */
export function importEnvOnce(env: NodeJS.ProcessEnv = process.env): { imported: string[] } {
    if (fs.existsSync(configFilePath())) return { imported: [] };
    const candidate: Record<string, unknown> = {};
    if (env.BACKEND_V2_URL) candidate.backendUrl = env.BACKEND_V2_URL;
    if (env.CLIENT_BACKGROUND_SHELL_TIMEOUT_MINUTES) candidate.backgroundShellTimeoutMinutes = Number(env.CLIENT_BACKGROUND_SHELL_TIMEOUT_MINUTES);
    if (env.MEDIA_MAX_MB) candidate.mediaMaxMb = Number(env.MEDIA_MAX_MB);
    if (env.TELEGRAM_BOT_TOKEN) candidate.telegramBotToken = env.TELEGRAM_BOT_TOKEN;
    const valid: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(candidate)) if (validators[k as Key](v) === undefined) valid[k] = v;
    if (Object.keys(valid).length === 0) return { imported: [] };
    saveFileConfig(valid as FileConfig);
    return { imported: Object.keys(valid) };
}
