/**
 * Rótulo compacto de chamada de tool, padrão Claude Code (`Bash(ls -la)`,
 * `Read(src/app.ts)`) em vez do nome cru da tool + JSON inteiro do input.
 * Só as tools mais comuns (execução/arquivo) ganham formatação dedicada —
 * o resto cai no fallback genérico (nome + JSON compacto truncado), que já
 * é bem mais legível que a linha de status anterior ("Chamando ferramenta:
 * X...", que nem mostrava o argumento).
 */
const MAX_FALLBACK_ARG_LENGTH = 60;

const LABELS: Record<string, string> = {
    shell: "Bash",
    write_file: "Write",
    read_file: "Read",
    list_files: "List",
    search_files: "Search",
    exec_background: "Bash (bg)",
};

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function primaryArg(name: string, input: unknown): string | undefined {
    if (!input || typeof input !== "object") return undefined;
    const obj = input as Record<string, unknown>;
    switch (name) {
        case "shell":
        case "exec_background":
            return typeof obj.command === "string" ? obj.command : undefined;
        case "write_file":
        case "read_file":
            return typeof obj.path === "string" ? obj.path : undefined;
        case "list_files":
        case "search_files":
            return typeof obj.path === "string" ? obj.path : undefined;
        default:
            return undefined;
    }
}

export function formatToolCall(name: string, input: unknown): string {
    const label = LABELS[name] ?? name;
    const known = primaryArg(name, input);
    if (known !== undefined) return `${label}(${truncate(known, 100)})`;

    if (input === undefined) return label;
    try {
        return `${label}(${truncate(JSON.stringify(input), MAX_FALLBACK_ARG_LENGTH)})`;
    } catch {
        return label;
    }
}

/**
 * Preview do RESULTADO de uma tool (ver extract-tool-activity.ts no
 * backend-v2, que já truncou strings/arrays grandes ANTES de chegar aqui —
 * este teto é só de LINHAS, pra caber num terminal sem estourar a
 * rolagem, padrão Claude Code ("+N linhas" em vez de despejar tudo).
 */
const MAX_RESULT_LINES = 6;
const MAX_RESULT_LINE_CHARS = 200;

function primaryResultText(name: string, output: unknown): string {
    if (output && typeof output === "object") {
        const obj = output as Record<string, unknown>;
        if (name === "shell" || name === "exec_background") {
            const stdout = typeof obj.stdout === "string" ? obj.stdout.trimEnd() : "";
            const stderr = typeof obj.stderr === "string" ? obj.stderr.trimEnd() : "";
            const combined = [stdout, stderr].filter(Boolean).join("\n");
            return combined || "(sem saída)";
        }
        if (typeof obj.error === "string" && obj.error) return obj.error;
    }
    if (typeof output === "string") return output;
    try {
        return JSON.stringify(output);
    } catch {
        return String(output);
    }
}

export function formatToolResult(name: string, output: unknown): string {
    const lines = primaryResultText(name, output).split("\n");
    const shown = lines.slice(0, MAX_RESULT_LINES).map((line) => truncate(line, MAX_RESULT_LINE_CHARS));
    const extra = lines.length - shown.length;
    return extra > 0 ? `${shown.join("\n")}\n… (+${extra} linhas)` : shown.join("\n");
}
