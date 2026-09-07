import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

/**
 * Porta de cli/src/exec/shell.ts#runCommand (que por sua vez veio de
 * backend/src/helpers/shell.ts) — sem `emitActivity` (mecanismo do
 * streaming de chat do backend single-owner, inerte fora daquele
 * contexto). A classificação de comando seguro (allowlist/confirmação) é
 * do backend-v2, não daqui — este módulo só executa o que já foi aprovado.
 *
 * Windows: roda via PowerShell (powershell.exe), não o cmd.exe que exec()
 * usaria por default.
 *
 * stdout/stderr vão pra ARQUIVO temporário, não pra um pipe (`exec`/
 * `execFile` usavam pipe) — dois bugs reais pegos ao vivo com um comando
 * que sobe processo em segundo plano (`comando &`, ex: `python3 -m
 * http.server 8080 &`):
 *
 * 1. O processo em segundo plano herda o MESMO stdout/stderr do processo
 *    que rodamos. Um PIPE só sinaliza EOF quando TODO processo que o
 *    segura fecha — nunca, nesse caso, já que o processo em segundo
 *    plano continua vivo de propósito. `exec`/`execFile` esperam esse
 *    EOF antes de resolver, então travavam até `TIMEOUT_MS` mesmo o
 *    comando tendo "terminado" na prática.
 * 2. Mesmo resolvendo mais cedo (via `spawn` + evento `exit`, que dispara
 *    quando o PROCESSO em si termina) e soltando nosso lado do pipe, o
 *    processo em segundo plano ainda segura o OUTRO lado — daí em diante,
 *    toda escrita dele nesse pipe (sem leitor nenhum) vira EPIPE/SIGPIPE
 *    do lado dele. Foi exatamente o que quebrou um `python3 -m
 *    http.server` real: toda requisição tenta logar no stdout, recebe
 *    EPIPE, e a resposta HTTP vem vazia/quebrada. ARQUIVO não tem esse
 *    problema — escrever num arquivo cujo leitor "desistiu" simplesmente
 *    funciona (não existe "sem leitor" pra arquivo comum), então um
 *    processo em segundo plano nunca quebra por causa da nossa limpeza.
 */

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 20_000;
/** Teto de LEITURA do arquivo — bem maior que MAX_OUTPUT_CHARS (só o teto de EXIBIÇÃO), evita carregar uma saída gigante inteira na memória só pra truncar depois. */
const MAX_READ_BYTES = 10 * 1024 * 1024;

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

/** Lê no máximo MAX_READ_BYTES do arquivo (nunca carrega um arquivo gigante inteiro só pra truncar depois) — "" se o arquivo não existir/não puder ser lido. */
function readCapped(filePath: string): string {
    let fd: number | undefined;
    try {
        fd = fs.openSync(filePath, "r");
        const size = fs.fstatSync(fd).size;
        const buffer = Buffer.alloc(Math.min(size, MAX_READ_BYTES));
        fs.readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.toString("utf8");
    } catch {
        return "";
    } finally {
        if (fd !== undefined) {
            try {
                fs.closeSync(fd);
            } catch {
                // já fechado/inválido — nada a fazer.
            }
        }
    }
}

function cleanupFile(filePath: string): void {
    try {
        fs.unlinkSync(filePath);
    } catch {
        // Um processo em segundo plano ainda pode ter o fd aberto — unlink
        // com o arquivo em uso é seguro no Unix (o espaço só é liberado de
        // verdade quando o último fd fechar); se já não existir, também
        // não há nada a fazer.
    }
}

export function runCommand(command: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const spawnOpts = { cwd: expandHome(cwd) };

    const tmpBase = path.join(os.tmpdir(), `helena-shell-${randomUUID()}`);
    const stdoutPath = `${tmpBase}.out`;
    const stderrPath = `${tmpBase}.err`;
    const stdoutFd = fs.openSync(stdoutPath, "w");
    const stderrFd = fs.openSync(stderrPath, "w");

    return new Promise((resolve) => {
        const child =
            process.platform === "win32"
                ? // PowerShell 5.1 (powershell.exe): sempre presente no Windows, ao
                  // contrário do pwsh.exe (PS7, não garantido).
                  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { ...spawnOpts, stdio: ["ignore", stdoutFd, stderrFd] })
                : spawn(command, { ...spawnOpts, shell: true, stdio: ["ignore", stdoutFd, stderrFd] });

        let systemError = "";
        let settled = false;

        const timer = setTimeout(() => {
            systemError = `comando excedeu o tempo limite (${TIMEOUT_MS / 1000}s)`;
            child.kill();
        }, TIMEOUT_MS);

        function finish(code: number | null): void {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            // Fecha NOSSOS fds — um processo em segundo plano que ainda os
            // segura continua escrevendo num arquivo de verdade, nunca
            // quebra por EPIPE só porque paramos de nos importar (ver doc
            // do módulo).
            try {
                fs.closeSync(stdoutFd);
            } catch {
                // já fechado — nada a fazer.
            }
            try {
                fs.closeSync(stderrFd);
            } catch {
                // já fechado — nada a fazer.
            }

            const stdout = readCapped(stdoutPath);
            const stderr = readCapped(stderrPath);
            cleanupFile(stdoutPath);
            cleanupFile(stderrPath);

            resolve({
                stdout: truncate(stdout),
                stderr: truncate(systemError ? [stderr, `[erro de sistema] ${systemError}`].filter(Boolean).join("\n") : stderr),
                code: systemError && code === null ? 1 : code,
            });
        }

        child.on("exit", (code) => finish(code));
        child.on("error", (err) => {
            systemError = err.message;
            finish(null);
        });
    });
}
