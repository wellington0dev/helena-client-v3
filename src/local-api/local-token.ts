import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { configDir } from "./paths.ts";

/**
 * Token LOCAL: o que a TUI (e qualquer outro processo desta máquina) precisa apresentar ao daemon.
 * Não tem relação com o JWT/ApiToken do backend — esses ficam só no daemon. Arquivo `0600`, ≥32 bytes
 * aleatórios, comparado em tempo constante. Limite honesto: qualquer processo do MESMO usuário do
 * SO consegue ler o arquivo (mesmo nível de proteção do `session.json` de hoje).
 */
const FILE = "local-token";

export function localTokenPath(): string {
    return path.join(configDir(), FILE);
}

function writeToken(token: string): void {
    const file = localTokenPath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // temp + rename: nunca deixa um arquivo pela metade nem com permissão frouxa mesmo por um instante.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, token, { mode: 0o600 });
    fs.renameSync(tmp, file);
}

function generate(): string {
    return crypto.randomBytes(32).toString("base64url");
}

/** Lê o token existente ou cria no primeiro boot. */
export function loadOrCreateLocalToken(): string {
    try {
        const existing = fs.readFileSync(localTokenPath(), "utf8").trim();
        if (existing.length >= 32) return existing;
    } catch {
        // ainda não existe — cria abaixo.
    }
    const token = generate();
    writeToken(token);
    return token;
}

/** `helena local-token rotate`: gera um novo e devolve; o chamador decide reiniciar o daemon/fechar conexões. */
export function rotateLocalToken(): string {
    const token = generate();
    writeToken(token);
    return token;
}

/** Lê SEM criar (lado cliente/TUI): undefined se o daemon nunca subiu nesta máquina. */
export function readLocalToken(): string | undefined {
    try {
        const token = fs.readFileSync(localTokenPath(), "utf8").trim();
        return token.length >= 32 ? token : undefined;
    } catch {
        return undefined;
    }
}

export function tokensMatch(expected: string, candidate: string | undefined): boolean {
    if (!candidate) return false;
    const a = crypto.createHash("sha256").update(expected).digest();
    const b = crypto.createHash("sha256").update(candidate).digest();
    return crypto.timingSafeEqual(a, b); // hash antes: tamanhos iguais sempre, sem vazar o comprimento do token
}
