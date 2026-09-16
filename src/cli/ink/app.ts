import React from "react";
import { Box, Static, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import chalk from "chalk";
import { resolveInterrupt, sendMessage, UnauthorizedError, type PendingConfirmation, type SendMessageResult, type TurnUsage } from "../backend.ts";
import { ConfigScreen } from "./config-screen.ts";
import { formatToolCall, formatToolResult } from "./format-tool-call.ts";
import { formatUsageLine } from "./format-usage.ts";
import { connectProgress, type ChatProgressEvent } from "./progress-client.ts";
import { formatProjectChecklist, formatProjectSummary, type ProjectStepsByRole } from "./project-progress.ts";
import { renderMarkdownAnsi } from "./render-markdown.ts";

/**
 * Comandos por barra — padrão opencode/Hermes Agent CLI: tudo dentro do
 * MESMO TUI (sem abrir processo/tela nova), `/comando` intercepta o
 * composer antes de virar mensagem de chat. `screen` troca a ÁREA
 * PRINCIPAL (histórico some, a tela assume o lugar) — Esc dentro da tela
 * sempre volta pro chat. Primeira tela: `/config` (preferências que hoje
 * só existiam no painel — telemetria, auto-approve shell, mensagem
 * proativa, tokens de API). Mais telas (Projects/Contatos/Integrações/
 * Canais/Cobrança/Uso) chegam depois, mesma arquitetura.
 */
type Screen = "chat" | "config";

const HELP_TEXT = `Comandos disponíveis:
  /config (ou /settings)  Preferências — telemetria, auto-approve shell, mensagem proativa, tokens de API
  /help (ou /?)           Esta lista
  Ctrl+C ou Ctrl+D        Sair`;

/** `ink`/`ink-text-input`/`ink-spinner` só publicam `.js` sem JSX — client/ roda `.ts` DIRETO com `node` (sem build, ver bin/helena.js), e o type-stripping nativo do Node não faz transform de JSX. `React.createElement` evita precisar de bundler só pra isto. */
const h = React.createElement;

/** `Static` é genérico (`Static<T>`), mas `createElement` não tem como instanciar esse genérico explicitamente sem JSX — este alias tipado resolve pro nosso único uso (histórico de `HistoryItem`). */
const HistoryStatic = Static as unknown as (props: { items: HistoryItem[]; children: (item: HistoryItem, index: number) => React.ReactNode }) => React.ReactElement;

export type HistoryItem =
    | { id: string; role: "user" | "assistant"; text: string }
    /** Chamada de tool — aparece na hora (ver ChatProgressEvent#tool_call), padrão Claude Code: `● Bash(comando)`. Nunca é editada depois de criada (ver comentário sobre <Static> abaixo) — o resultado, quando existir, é uma entrada NOVA (tool_result), nunca uma mutação desta. */
    | { id: string; role: "tool_call"; name: string; input: unknown }
    /** Resultado de UMA tool — só existe depois que o turno inteiro termina (`SendMessageResult#toolActivity`, ver backend.ts), então sempre aparece em lote, depois de todas as chamadas ao vivo do mesmo turno — nunca intercalado 1-a-1 (o Agent Beta do Genkit não expõe resultado durante o streaming, só no fim). */
    | { id: string; role: "tool_result"; name: string; output: unknown }
    /** Aviso empurrado FORA de qualquer turno de chat em andamento — marco de Project da equipe de dev (pausou/concluiu) ou conclusão de shell em segundo plano (ver ChatProgressEvent#project_event/job_done). Nunca gated por "sending": pode chegar a qualquer momento, mesmo sem o dono ter mandado nada agora. */
    | { id: string; role: "notice"; text: string; tone: "success" | "warn" | "danger" }
    /** Linha discreta de custo do turno (tokens/duração) — ver SendMessageResult#usage. Sempre logo ABAIXO do texto do turno a que pertence, nunca Static-reordenada pra outro lugar. */
    | { id: string; role: "usage"; usage: TurnUsage };

export type SessionOutcome = { type: "exit" } | { type: "relogin"; history: HistoryItem[]; sessionId?: string };

export interface AppProps {
    backendUrl: string;
    token: string;
    invocationCwd: string;
    machineName: string;
    initialHistory?: HistoryItem[];
    initialSessionId?: string;
    onDone: (outcome: SessionOutcome) => void;
}

let nextId = 0;
function historyItem(role: "user" | "assistant", text: string): HistoryItem {
    return { id: `h${nextId++}`, role, text };
}
function toolCallItem(name: string, input: unknown): HistoryItem {
    return { id: `h${nextId++}`, role: "tool_call", name, input };
}
function toolResultItem(name: string, output: unknown): HistoryItem {
    return { id: `h${nextId++}`, role: "tool_result", name, output };
}
function noticeItem(text: string, tone: "success" | "warn" | "danger"): HistoryItem {
    return { id: `h${nextId++}`, role: "notice", text, tone };
}
function usageItem(usage: TurnUsage): HistoryItem {
    return { id: `h${nextId++}`, role: "usage", usage };
}

function HistoryLine({ item }: { item: HistoryItem }): React.ReactElement {
    if (item.role === "tool_call") {
        return h(Box, null, h(Text, { color: "gray" }, "● ", formatToolCall(item.name, item.input)));
    }
    if (item.role === "tool_result") {
        return h(Box, { flexDirection: "column", marginBottom: 1, paddingLeft: 2 }, h(Text, { color: "gray", dimColor: true }, "⎿ ", formatToolResult(item.name, item.output)));
    }
    if (item.role === "notice") {
        const color = item.tone === "success" ? "green" : item.tone === "danger" ? "red" : "yellow";
        return h(Box, { marginBottom: 1 }, h(Text, { color }, item.text));
    }
    if (item.role === "usage") {
        return h(Box, { marginBottom: 1 }, h(Text, { color: "gray", dimColor: true }, formatUsageLine(item.usage)));
    }
    const label = item.role === "user" ? chalk.cyan.bold("Você") : chalk.magenta.bold("Helena");
    const body = item.role === "assistant" ? renderMarkdownAnsi(item.text) : item.text;
    return h(Box, { flexDirection: "column", marginBottom: 1 }, h(Text, null, `${label}:`), h(Text, null, body));
}

/** Checklist ao vivo de Project(s) da equipe de dev em andamento — some sozinho quando o Project termina (o resultado final vira um item "notice" permanente no histórico, ver ChatProgressEvent#project_event). Raramente mais de um Project por vez, mas o Map suporta. */
function ProjectProgressPanel({ projectSteps }: { projectSteps: Map<string, ProjectStepsByRole> }): React.ReactElement | null {
    if (projectSteps.size === 0) return null;

    return h(
        Box,
        { flexDirection: "column", marginBottom: 1 },
        ...[...projectSteps.entries()].map(([projectId, steps]) =>
            h(
                Box,
                { key: projectId, flexDirection: "column", borderStyle: "round", borderColor: "cyan", paddingX: 1 },
                h(Text, { color: "cyan", bold: true }, `Equipe de dev — ${formatProjectSummary(steps)}`),
                ...formatProjectChecklist(steps).map((line, i) => h(Text, { key: i, dimColor: line.startsWith("○") }, line)),
            ),
        ),
    );
}

function StatusLine({ text }: { text: string }): React.ReactElement {
    return h(Box, { gap: 1 }, h(Text, { color: "cyan" }, h(Spinner, { type: "dots" })), h(Text, { dimColor: true }, text));
}

function Composer(props: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; disabled: boolean }): React.ReactElement {
    return h(
        Box,
        { gap: 1 },
        h(Text, { color: "green", bold: true }, "❯"),
        h(TextInput, { value: props.value, onChange: props.onChange, onSubmit: props.onSubmit, placeholder: "Escreva sua mensagem...", focus: !props.disabled }),
    );
}

function ConfirmationPrompt(props: { pending: PendingConfirmation; onAnswer: (approved: boolean) => void }): React.ReactElement {
    useInput((input: string) => {
        const normalized = input.trim().toLowerCase();
        if (normalized === "s") props.onAnswer(true);
        else if (normalized === "n") props.onAnswer(false);
    });

    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1 },
        h(Text, { color: "yellow", bold: true }, `Aprovação necessária — ${props.pending.tool}`),
        h(Text, { dimColor: true }, JSON.stringify(props.pending.input, null, 2)),
        h(Text, null, "Aprovar? (s/n)"),
    );
}

export function App(props: AppProps): React.ReactElement {
    const { backendUrl, invocationCwd, machineName, onDone } = props;
    const [token] = React.useState(props.token);
    const [history, setHistory] = React.useState<HistoryItem[]>(props.initialHistory ?? []);
    const [sessionId, setSessionId] = React.useState<string | undefined>(props.initialSessionId);
    const [inputValue, setInputValue] = React.useState("");
    const [sending, setSending] = React.useState(false);
    const [statusLine, setStatusLine] = React.useState("Helena está pensando...");
    const [pending, setPending] = React.useState<PendingConfirmation | undefined>(undefined);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [projectSteps, setProjectSteps] = React.useState<Map<string, ProjectStepsByRole>>(new Map());
    const [screen, setScreen] = React.useState<Screen>("chat");

    // Refs pra ler o valor ATUAL de dentro do callback do WS (que só é
    // registrado uma vez no efeito abaixo) sem precisar reconectar o
    // WebSocket toda vez que `history`/`sessionId` mudam.
    const historyRef = React.useRef(history);
    historyRef.current = history;
    const sessionIdRef = React.useRef(sessionId);
    sessionIdRef.current = sessionId;
    const sendingRef = React.useRef(sending);
    sendingRef.current = sending;

    React.useEffect(() => {
        return connectProgress(backendUrl, token, (event: ChatProgressEvent) => {
            // tool_call/turn_start só fazem sentido DENTRO de um turno que ESTE
            // cliente disparou (senão vira ruído de um turno de outra sessão/
            // dispositivo) — mas project_step/project_event/job_done são
            // trabalho em SEGUNDO PLANO (equipe de dev, shell background),
            // nunca ligado a "sending" daqui: têm que aparecer mesmo sem o
            // dono ter acabado de mandar mensagem nenhuma.
            if (event.type === "tool_call") {
                if (!sendingRef.current) return;
                // Vira uma entrada PERMANENTE do histórico na hora (padrão Claude Code) — antes só
                // sobrescrevia a linha de status, que sumia sem deixar rastro assim que o turno acabava.
                setHistory((prev) => [...prev, toolCallItem(event.tool, event.input)]);
                setStatusLine("Helena está trabalhando...");
            } else if (event.type === "turn_start") {
                if (!sendingRef.current) return;
                setStatusLine("Helena está pensando...");
            } else if (event.type === "project_step") {
                setProjectSteps((prev) => {
                    const next = new Map(prev);
                    next.set(event.projectId, { ...next.get(event.projectId), [event.role]: event.status });
                    return next;
                });
            } else if (event.type === "project_event") {
                setHistory((prev) => [...prev, noticeItem(event.summary, event.kind === "completed" ? "success" : "warn")]);
                if (event.kind === "completed" || event.kind === "cancelled") {
                    setProjectSteps((prev) => {
                        if (!prev.has(event.projectId)) return prev;
                        const next = new Map(prev);
                        next.delete(event.projectId);
                        return next;
                    });
                }
            } else if (event.type === "job_done") {
                setHistory((prev) => [...prev, noticeItem(event.summary, event.ok ? "success" : "danger")]);
            }
        });
    }, [backendUrl, token]);

    useInput((input: string, key: { ctrl: boolean }) => {
        if (key.ctrl && (input === "c" || input === "d")) {
            onDone({ type: "exit" });
        }
    });

    async function runTurn(action: () => Promise<SendMessageResult>): Promise<void> {
        setSending(true);
        setStatusLine("Helena está pensando...");
        setError(undefined);
        try {
            const result = await action();
            setSessionId(result.sessionId);
            // Resultado de tool só existe DEPOIS que o turno inteiro termina (ver toolActivity em backend.ts)
            // — entra em lote aqui, depois de todas as chamadas ao vivo já mostradas, antes da resposta final.
            const toolResults = (result.toolActivity ?? []).map((entry) => toolResultItem(entry.name, entry.output));
            setHistory((prev) => [...prev, ...toolResults, historyItem("assistant", result.text), ...(result.usage ? [usageItem(result.usage)] : [])]);
            setPending(result.pending?.[0]);
        } catch (err) {
            if (err instanceof UnauthorizedError) {
                onDone({ type: "relogin", history: historyRef.current, sessionId: sessionIdRef.current });
                return;
            }
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSending(false);
        }
    }

    function handleCommand(raw: string): void {
        const cmd = raw.slice(1).trim().toLowerCase();
        if (cmd === "config" || cmd === "settings") {
            setScreen("config");
        } else if (cmd === "help" || cmd === "?") {
            setHistory((prev) => [...prev, noticeItem(HELP_TEXT, "success")]);
        } else {
            setHistory((prev) => [...prev, noticeItem(`Comando desconhecido: "${raw}" — digite /help pra ver os comandos disponíveis.`, "warn")]);
        }
    }

    function handleSubmit(text: string): void {
        const trimmed = text.trim();
        setInputValue("");
        if (!trimmed || sending || pending) return;
        if (trimmed.startsWith("/")) {
            handleCommand(trimmed);
            return;
        }
        setHistory((prev) => [...prev, historyItem("user", trimmed)]);
        void runTurn(() => sendMessage(backendUrl, token, { text: trimmed, sessionId, cwd: invocationCwd, machineName }));
    }

    function handleConfirmation(approved: boolean): void {
        if (!pending || !sessionId) return;
        const current = pending;
        const activeSessionId = sessionId;
        setPending(undefined);
        void runTurn(() => resolveInterrupt(backendUrl, token, activeSessionId, current.tool, current.ref, approved, approved ? undefined : "Recusado pelo usuário no CLI."));
    }

    if (screen === "config") {
        return h(ConfigScreen, { backendUrl, token, onExit: () => setScreen("chat") });
    }

    let liveRegion: React.ReactElement;
    if (pending) liveRegion = h(ConfirmationPrompt, { pending, onAnswer: handleConfirmation });
    else if (sending) liveRegion = h(StatusLine, { text: statusLine });
    else liveRegion = h(Composer, { value: inputValue, onChange: setInputValue, onSubmit: handleSubmit, disabled: false });

    return h(
        Box,
        { flexDirection: "column" },
        h(HistoryStatic, { items: history, children: (item: HistoryItem) => h(HistoryLine, { key: item.id, item }) }),
        h(ProjectProgressPanel, { projectSteps }),
        error ? h(Text, { color: "red" }, `[erro] ${error}`) : null,
        liveRegion,
    );
}
