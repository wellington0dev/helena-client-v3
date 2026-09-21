import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Token de longa duração desta MÁQUINA (WhatsApp/Telegram/execução remota
 * — nunca expira sozinho, só se revogado) — antes só existia via
 * `BACKEND_V2_API_TOKEN` no `.env`, copiado manualmente depois de um
 * `POST /auth/api-tokens` que o dono tinha que descobrir como fazer
 * sozinho (achado real, 2026-09-16: `install.sh` exigia esse campo antes
 * de sequer subir o painel — e o painel era o único jeito fácil de
 * conseguir o JWT necessário pra gerar o token, um loop sem saída). Agora
 * provisionado sozinho no primeiro login (painel OU `helena` CLI, ver
 * local-api/server.ts#handleCliSession) — este arquivo só guarda o resultado.
 *
 * Mesmo diretório de `cli/session-store.ts` (`~/.config/helena/`) — é a
 * MESMA identidade de "Helena nesta máquina", só que de vida mais longa
 * que o JWT de sessão. Fora do diretório do repo `client/` de propósito:
 * sobrevive a `git reset --hard`/reclone, nunca arrisca ir pra um commit.
 */
const DEVICE_TOKEN_PATH = path.join(os.homedir(), ".config", "helena", "device-token.json");

interface StoredDeviceToken {
    token: string;
}

function readStoredToken(): string | undefined {
    try {
        const raw = fs.readFileSync(DEVICE_TOKEN_PATH, "utf8");
        const parsed = JSON.parse(raw) as StoredDeviceToken;
        return parsed.token || undefined;
    } catch {
        return undefined;
    }
}

/**
 * `BACKEND_V2_API_TOKEN` do `.env` como FALLBACK — nunca quebra quem já
 * configurou manualmente antes deste mecanismo existir. O arquivo local
 * (provisionado sozinho) tem prioridade quando os dois existirem, porque
 * é a fonte mais recente.
 */
export function loadDeviceToken(): string | undefined {
    return readStoredToken() || process.env.BACKEND_V2_API_TOKEN || undefined;
}

export function saveDeviceToken(token: string): void {
    fs.mkdirSync(path.dirname(DEVICE_TOKEN_PATH), { recursive: true });
    fs.writeFileSync(DEVICE_TOKEN_PATH, JSON.stringify({ token } satisfies StoredDeviceToken), { mode: 0o600 });
}
