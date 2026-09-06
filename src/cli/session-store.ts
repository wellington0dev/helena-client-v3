import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Cache local do JWT do `helena` (CLI) — mesmo espírito do `localStorage`
 * que o painel Angular usa (AuthService#TOKEN_KEY), só que em arquivo (não
 * tem navegador aqui). Relogar só acontece quando o token falta ou o
 * backend devolve 401 (expirado) — nunca a cada execução.
 */
const SESSION_PATH = path.join(os.homedir(), ".config", "helena", "session.json");

interface StoredSession {
    accessToken: string;
}

export function loadSession(): StoredSession | undefined {
    try {
        const raw = fs.readFileSync(SESSION_PATH, "utf8");
        const parsed = JSON.parse(raw) as StoredSession;
        return parsed.accessToken ? parsed : undefined;
    } catch {
        return undefined;
    }
}

export function saveSession(accessToken: string): void {
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    fs.writeFileSync(SESSION_PATH, JSON.stringify({ accessToken } satisfies StoredSession), { mode: 0o600 });
}

export function clearSession(): void {
    try {
        fs.unlinkSync(SESSION_PATH);
    } catch {
        // já não existia — nada a fazer.
    }
}
