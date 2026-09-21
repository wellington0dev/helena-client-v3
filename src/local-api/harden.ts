import fs from "node:fs";
import path from "node:path";

/**
 * Endurece permissões de segredos locais (achado C5 da auditoria: `.env` e `.whatsapp-auth/*.json` — chaves de
 * sessão Signal — estavam 644, legíveis por qualquer usuário da máquina). Arquivos → 0600, diretórios → 0700.
 * Só POSIX (no Windows as permissões são por ACL). Devolve o que mudou, pra logar/mostrar no `doctor`.
 */
export function hardenPermissions(targets: string[]): { fixed: string[] } {
    const fixed: string[] = [];
    if (process.platform === "win32") return { fixed };

    function fix(target: string): void {
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(target);
        } catch {
            return; // não existe — nada a endurecer.
        }
        if (stat.isSymbolicLink()) return; // nunca segue link (poderia apontar pra fora)
        const want = stat.isDirectory() ? 0o700 : 0o600;
        if ((stat.mode & 0o077) !== 0) {
            try {
                fs.chmodSync(target, want);
                fixed.push(target);
            } catch {
                // sem permissão pra mudar (arquivo de outro usuário): o doctor reporta.
            }
        }
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(target)) fix(path.join(target, name));
        }
    }
    for (const target of targets) fix(target);
    return { fixed };
}

/** Lista o que está com permissão frouxa (grupo/outros com algum acesso), sem alterar nada. */
export function looseSecrets(targets: string[]): string[] {
    const loose: string[] = [];
    if (process.platform === "win32") return loose;
    function scan(target: string): void {
        let stat: fs.Stats;
        try {
            stat = fs.lstatSync(target);
        } catch {
            return;
        }
        if (stat.isSymbolicLink()) return;
        if ((stat.mode & 0o077) !== 0) loose.push(target);
        if (stat.isDirectory()) for (const name of fs.readdirSync(target)) scan(path.join(target, name));
    }
    for (const target of targets) scan(target);
    return loose;
}
