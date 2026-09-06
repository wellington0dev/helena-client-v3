import { exec, execFile } from "child_process";
import os from "os";
import path from "path";

/**
 * Porta de cli/src/exec/shell.ts#runCommand (que por sua vez veio de
 * backend/src/helpers/shell.ts) — sem `emitActivity` (mecanismo do
 * streaming de chat do backend single-owner, inerte fora daquele
 * contexto). A classificação de comando seguro (allowlist/confirmação) é
 * do backend-v2, não daqui — este módulo só executa o que já foi aprovado.
 *
 * Windows: roda via PowerShell (powershell.exe), não o cmd.exe que exec()
 * usaria por default.
 */

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;

function truncate(text: string): string {
    return text.length > MAX_OUTPUT_CHARS ? text.slice(0, MAX_OUTPUT_CHARS) + `\n... (saída truncada, ${text.length - MAX_OUTPUT_CHARS} caracteres a mais)` : text;
}

/** Resolve "~" pro home do usuário — cross-platform via os.homedir() (funciona também no formato "~\\x" do Windows). */
function expandHome(cwd: string | undefined): string | undefined {
    if (!cwd) return cwd;
    if (cwd === "~") return os.homedir();
    const match = /^~[/\\](.*)$/.exec(cwd);
    if (match) return path.join(os.homedir(), match[1]!);
    return cwd;
}

export function runCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const opts = { cwd: expandHome(cwd), timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" as const };

    return new Promise((resolve) => {
        const handle = (error: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => {
            const isProcessExitCode = typeof error?.code === "number";
            const stderrOutput = error && !isProcessExitCode ? [stderr, `[erro de sistema] ${error.message}`].filter(Boolean).join("\n") : stderr;

            resolve({
                stdout: truncate(stdout),
                stderr: truncate(stderrOutput),
                code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
            });
        };

        if (process.platform === "win32") {
            // PowerShell 5.1 (powershell.exe): sempre presente no Windows, ao
            // contrário do pwsh.exe (PS7, não garantido).
            execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], opts, handle);
        } else {
            exec(command, opts, handle);
        }
    });
}
