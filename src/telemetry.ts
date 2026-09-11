import pkg from "../package.json" with { type: "json" };
import { config } from "./config.ts";

/**
 * Emissor de telemetria pro DAEMON (`main.ts`/`machine-agent.ts`/canais) —
 * achado em revisão no backend-v2 (2026-09-11): `POST /telemetry/logs` já
 * existia e funcionava, mas nenhum processo do `client/` nunca chamava —
 * só o painel Angular (erro de renderização da própria tela), nada da
 * execução REAL da Helena (comando rodado, mensagem processada). Usa o
 * MESMO token de API de longa duração que `channels/backend-client.ts` já
 * usa pra `/channels/inbound` — `TelemetryController` aceita os dois
 * (`JwtOrApiTokenGuard`, ver backend-v2/src/auth/guards/).
 *
 * Função pura, não classe (mesmo motivo de backend-client.ts — este
 * pacote roda `.ts` nativo sob `--experimental-strip-types`, que recusa o
 * açúcar sintático de `constructor(private x)`).
 *
 * Regra de privacidade (pedido explícito do dono): NUNCA manda conteúdo de
 * mensagem, comando shell, caminho de arquivo ou qualquer dado do usuário
 * em `context` — só metadado estrutural do próprio processo (plataforma,
 * versão do Node, versão do client). `message`/`stack` também nunca
 * deveriam carregar isso na prática (são texto de erro do RUNTIME, não
 * echo de input), mas o teto de tamanho do DTO (4000/20000 chars, ver
 * submit-telemetry-log.dto.ts) já limita o estrago se algum dia carregarem.
 *
 * Mesmo teto de spam do handler do painel (20 relatos por processo + nunca
 * repete a mesma mensagem seguida) — nunca deixa o PRÓPRIO envio virar
 * outro erro sem tratamento.
 */
const MAX_REPORTS_PER_PROCESS = 20;
let reportedCount = 0;
let lastMessage = "";

export type TelemetryLevel = "error" | "warn" | "info" | "performance";

export interface ReportTelemetryOptions {
    stack?: string;
    /** "client" | "machine-agent" | "whatsapp" | "telegram" | "cli" — livre, descreve de onde veio dentro do próprio client/. */
    source?: string;
    /** Bearer explícito — o `cli/` (chat interativo) autentica com JWT de login, não o token de API do daemon; ausente usa `config.backendApiToken`. */
    token?: string;
}

export async function reportTelemetry(level: TelemetryLevel, message: string, opts?: ReportTelemetryOptions): Promise<void> {
    const token = opts?.token ?? config.backendApiToken;
    if (!config.backendUrl || !token) return;
    if (reportedCount >= MAX_REPORTS_PER_PROCESS) return;
    if (message === lastMessage) return;
    lastMessage = message;
    reportedCount++;

    try {
        await fetch(`${config.backendUrl}/telemetry/logs`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                level,
                message: message.slice(0, 4000),
                stack: opts?.stack?.slice(0, 20000),
                source: opts?.source ?? "client",
                appVersion: pkg.version,
                context: { platform: process.platform, nodeVersion: process.version },
            }),
        });
    } catch {
        // best-effort — telemetria nunca pode virar um segundo problema.
    }
}

/** Reporta uma `Error` (ou qualquer coisa lançada) já separando message/stack — cobre o caso comum de `catch (err) { reportError(err) }`. */
export function reportError(err: unknown, source?: string, token?: string): void {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    void reportTelemetry("error", message, { stack, source, token });
}
