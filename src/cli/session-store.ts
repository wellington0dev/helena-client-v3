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
    /** Refresh token rotativo (backend `POST /auth/refresh`). Ausente em sessões legadas (JWT obtido direto, sem refresh). */
    refreshToken?: string;
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

/**
 * Grava de forma ATÔMICA (temp + rename, 0600): o refresh token é rotativo — se o processo cair no meio da
 * escrita e o arquivo ficar truncado, a sessão inteira se perde. Quem renova grava ANTES de usar o par novo.
 */
export function saveSession(accessToken: string, refreshToken?: string): void {
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true, mode: 0o700 });
    const tmp = `${SESSION_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ accessToken, ...(refreshToken ? { refreshToken } : {}) } satisfies StoredSession), { mode: 0o600 });
    fs.renameSync(tmp, SESSION_PATH);
}

export function clearSession(): void {
    try {
        fs.unlinkSync(SESSION_PATH);
    } catch {
        // já não existia — nada a fazer.
    }
}
