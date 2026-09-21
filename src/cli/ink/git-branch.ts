import fs from "node:fs";
import path from "node:path";

/**
 * Branch atual lida direto de `.git/HEAD` (sem spawnar `git` — roda a cada refresh da barra de status).
 * Sobe a partir de `cwd` até achar `.git` (pasta, ou arquivo `gitdir: ...` de worktree/submódulo).
 * HEAD solto (detached) devolve os 7 primeiros caracteres do commit. Sem repositório/erro → undefined.
 */
export function readGitBranch(cwd: string): string | undefined {
    let dir = path.resolve(cwd);
    for (let i = 0; i < 40; i++) {
        const dotGit = path.join(dir, ".git");
        try {
            const stat = fs.statSync(dotGit);
            let gitDir = dotGit;
            if (stat.isFile()) {
                const match = fs.readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
                if (!match) return undefined;
                gitDir = path.resolve(dir, match[1]!.trim());
            }
            const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
            const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
            if (ref) return ref[1];
            return /^[0-9a-f]{7,}$/i.test(head) ? head.slice(0, 7) : undefined;
        } catch {
            // sem .git neste nível — sobe
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
    return undefined;
}
