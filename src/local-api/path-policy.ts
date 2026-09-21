import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configDir } from "./paths.ts";

/**
 * Política de acesso a arquivos das capabilities `read_file`/`list_files`/`search_files`/`write_file`. Até aqui
 * qualquer caminho era aceito (achado C1 da auditoria de 10/09: prompt injection podia pedir `~/.ssh/id_rsa` ou o
 * `.env` do client e receber de volta no chat). Agora:
 *   1. NEGADOS SEMPRE: diretórios sensíveis (`~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, a pasta de config da Helena,
 *      o diretório de auth do WhatsApp) e arquivos por nome (`.env*` exceto `.env.example`, `*.pem`, `*.key`, chaves
 *      SSH, `.netrc`, os tokens da Helena) + `deniedPaths` do usuário.
 *   2. Se `allowedDirs` não estiver vazio, só o que estiver DENTRO delas (resolvendo links simbólicos).
 */
export interface PathPolicy {
    allowedDirs: string[];
    deniedPaths: string[];
    /** Diretório de auth do WhatsApp (variável, por isso entra como parâmetro). */
    extraDeniedDirs?: string[];
}

export type AccessCheck = { ok: true; resolved: string } | { ok: false; reason: string };

const DENIED_NAME_PATTERNS: RegExp[] = [
    /^\.env(\..+)?$/i,
    /\.(pem|key|p12|pfx|ppk)$/i,
    /^id_(rsa|dsa|ecdsa|ed25519)(?!.*\.pub$).*$/i,
    /^\.netrc$/i,
    /^(creds|credentials)\.json$/i,
    /^(local-token|session\.json|device-token\.json)$/i,
];
const ALLOWED_NAME_EXCEPTIONS = /^\.env\.(example|sample|template)$/i;

function expand(p: string): string {
    if (p === "~") return os.homedir();
    if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
    return p;
}

/** Resolve links simbólicos do trecho que EXISTE e reanexa o resto (o alvo pode ainda não existir, ex.: escrita). */
export function realResolve(target: string): string {
    const absolute = path.resolve(expand(target));
    let existing = absolute;
    const rest: string[] = [];
    while (!fs.existsSync(existing)) {
        const parent = path.dirname(existing);
        if (parent === existing) break;
        rest.unshift(path.basename(existing));
        existing = parent;
    }
    let real: string;
    try {
        real = fs.realpathSync(existing);
    } catch {
        real = existing;
    }
    return path.join(real, ...rest);
}

function isInside(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function defaultDeniedDirs(): string[] {
    const home = os.homedir();
    return [".ssh", ".gnupg", ".aws", ".kube", path.join(".config", "gcloud")].map((d) => path.join(home, d)).concat(configDir());
}

export function checkPathAccess(target: string, policy: PathPolicy): AccessCheck {
    const resolved = realResolve(target);
    const denied = [...defaultDeniedDirs(), ...(policy.extraDeniedDirs ?? []), ...policy.deniedPaths].map((d) => realResolve(d));
    for (const d of denied) {
        if (isInside(resolved, d)) return { ok: false, reason: `caminho protegido pela política de arquivos (${path.basename(d) || d})` };
    }
    const base = path.basename(resolved);
    if (!ALLOWED_NAME_EXCEPTIONS.test(base) && DENIED_NAME_PATTERNS.some((re) => re.test(base))) {
        return { ok: false, reason: `arquivo sensível (${base}) — protegido pela política de arquivos` };
    }
    if (policy.allowedDirs.length > 0) {
        const allowed = policy.allowedDirs.map((d) => realResolve(d));
        if (!allowed.some((a) => isInside(resolved, a))) return { ok: false, reason: "fora dos diretórios permitidos (allowedDirs)" };
    }
    return { ok: true, resolved };
}
