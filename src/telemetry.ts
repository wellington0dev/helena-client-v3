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
 * outro erro sem tratamento. Teto e dedupe são POR NÍVEL: com um contador
 * só, um backend oscilando (ECONNREFUSED/502 alternando durante um deploy)
 * esgotava os 20 relatos com o `warn` de conexão do machine-agent e o
 * `uncaughtException` de verdade, depois, era descartado em silêncio.
 */
const MAX_REPORTS_PER_LEVEL = 20;

export type TelemetryLevel = "error" | "warn" | "info" | "performance";

const budget = new Map<TelemetryLevel, { count: number; lastMessage: string }>();

/** Consome um relato do orçamento do nível — false se estourou o teto ou repete a última mensagem DESTE nível. */
export function takeReportSlot(level: TelemetryLevel, message: string): boolean {
    const state = budget.get(level) ?? { count: 0, lastMessage: "" };
    budget.set(level, state);
    if (state.count >= MAX_REPORTS_PER_LEVEL || message === state.lastMessage) return false;
    state.count++;
    state.lastMessage = message;
    return true;
}

/** Só pra teste — zera o orçamento de todos os níveis. */
export function resetReportBudget(): void {
    budget.clear();
}

export interface ReportTelemetryOptions {
    stack?: string;
    /** "client" | "machine-agent" | "whatsapp" | "telegram" | "cli" — livre, descreve de onde veio dentro do próprio client/. */
    source?: string;
    /** Bearer explícito — o `cli/` (chat interativo) autentica com JWT de login, não o token de API do daemon; ausente usa `config.backendApiToken`. */
    token?: string;
}

/**
 * Rede de segurança da regra de privacidade acima — com erro de canal (WhatsApp/Telegram) e de HTTP entrando na
 * telemetria, `message`/`stack` passam a poder carregar dado do dono sem ninguém perceber: JID/telefone de contato
 * (`5511999999999@s.whatsapp.net`), e-mail, ou um token num corpo de erro ecoado. Mascara antes de sair da máquina.
 * Sequência de 8+ dígitos cobre telefone (com ou sem DDI) sem pegar porta/status HTTP.
 */
export function redact(text: string): string {
    return text
        .replace(/[\w.+-]+@(s\.whatsapp\.net|g\.us|lid|c\.us|broadcast)\b/g, "<jid>")
        .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
        .replace(/Bearer\s+[\w.~+/=-]+/gi, "Bearer <token>")
        .replace(/\b[a-f0-9]{32,}\b/gi, "<hex>")
        .replace(/\+?\d[\d ()-]{6,}\d/g, (match) => (match.replace(/\D/g, "").length >= 8 ? "<número>" : match));
}

export async function reportTelemetry(level: TelemetryLevel, rawMessage: string, opts?: ReportTelemetryOptions): Promise<void> {
    const token = opts?.token ?? config.backendApiToken;
    if (!config.backendUrl || !token) return;
    const message = redact(rawMessage);
    if (!takeReportSlot(level, message)) return;

    try {
        await fetch(`${config.backendUrl}/telemetry/logs`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                level,
                message: message.slice(0, 4000),
                stack: opts?.stack ? redact(opts.stack).slice(0, 20000) : undefined,
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

/**
 * `console.error` local + relato de telemetria numa chamada só — substitui o `catch (e) { console.error(...) }` que
 * engolia o erro sem nunca chegar à telemetria (36 pontos no daemon até 2026-09-23). `what` é texto FIXO do código
 * (nunca interpolar JID/conteúdo de mensagem nele); o detalhe variável vem do próprio erro e passa por `redact`.
 */
export function captureError(source: string, what: string, err?: unknown, level: TelemetryLevel = "error"): void {
    if (err === undefined) console.error(`[${source}] ${what}`);
    else console.error(`[${source}] ${what}:`, err);
    const detail = err === undefined ? "" : `: ${err instanceof Error ? err.message : String(err)}`;
    void reportTelemetry(level, `${what}${detail}`, { source, stack: err instanceof Error ? err.stack : undefined });
}
