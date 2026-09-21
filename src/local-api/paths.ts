import os from "node:os";
import path from "node:path";

/**
 * Diretório de configuração/credenciais da Helena nesta máquina. Calculado a CADA chamada (não no
 * module-load) pra os testes conseguirem isolar `HOME` — mesmo motivo de `session-store.ts`, que
 * fixa o caminho no import e por isso os testes dele trocam o HOME antes de importar.
 * Linux/macOS: `~/.config/helena` (igual ao que `session-store.ts`/`device-token.ts` já usam).
 * Windows: `%APPDATA%\Helena`.
 */
export function configDir(): string {
    if (process.platform === "win32" && process.env.APPDATA) return path.join(process.env.APPDATA, "Helena");
    return path.join(os.homedir(), ".config", "helena");
}
