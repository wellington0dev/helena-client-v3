import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import { resolveInterrupt, sendMessage, UnauthorizedError, type PendingConfirmation, type SendMessageResult } from "../backend.ts";
import { findCommand, matchCommands, type Command, type Screen } from "./commands.ts";
import { ConfigScreen } from "./config-screen.ts";
import { ChannelsScreen } from "./channels-screen.ts";
import { ContactsScreen } from "./contacts-screen.ts";
import { McpScreen } from "./mcp-screen.ts";
import { BillingScreen } from "./billing-screen.ts";
import { ProjectsScreen } from "./projects-screen.ts";
import { UsageScreen } from "./usage-screen.ts";
import { config } from "../../config.ts";
import { formatToolCall, formatToolResult } from "./format-tool-call.ts";
import { formatUsageLine } from "./format-usage.ts";
import { historyItem, noticeItem, toolCallItem, toolResultItem, usageItem, type HistoryItem } from "./history-item.ts";
import { connectProgress, type ChatProgressEvent, type AgentPlan, type PlanStep } from "./progress-client.ts";
import { formatProjectChecklist, formatProjectSummary, type ProjectStepsByRole } from "./project-progress.ts";
import { renderMarkdownAnsi } from "./render-markdown.ts";
import { countWrappedLines, fitToViewport, measureHistoryItem } from "./viewport.ts";
import { c, theme } from "./theme.ts";

/**
 * Comandos por barra — padrão opencode/Hermes Agent CLI: tudo dentro do
 * MESMO TUI (sem abrir processo/tela nova), `/comando` intercepta o
 * composer antes de virar mensagem de chat. `screen` troca a ÁREA
 * PRINCIPAL (histórico some, a tela assume o lugar) — Esc dentro da tela
 * sempre volta pro chat. Primeira tela: `/config` (preferências que hoje
 * só existiam no painel — telemetria, auto-approve shell, mensagem
 * proativa, tokens de API). Mais telas (Projects/Contatos/Integrações/
 * Canais/Cobrança/Uso) chegam depois, mesma arquitetura. Comandos e o
 * texto de `/help` vêm do registro único em `commands.ts` — ver lá.
 *
 * Fullscreen de verdade (alt-screen, ver chat.ts) — SEM scrollback: o que
 * a gente manda renderizar além de `rows` do terminal simplesmente SOME,
 * não fica acessível rolando o terminal depois (ao contrário do modo
 * normal de antes). Por isso o histórico não usa mais `<Static>` (que
 * imprime tudo permanentemente, sem limite) — cada render recalcula
 * quantas mensagens CABEM (`viewport.ts#fitToViewport`) e só desenha
 * essa janela. `HistoryItem`/construtores moraram pra `history-item.ts`
 * pra `viewport.ts` poder tipar sem import circular (mesmo motivo do
 * `Screen` ter saído pra `commands.ts`).
 */
export type { HistoryItem } from "./history-item.ts";

/** `ink`/`ink-text-input`/`ink-spinner` só publicam `.js` sem JSX — client/ roda `.ts` DIRETO com `node` (sem build, ver bin/helena.js), e o type-stripping nativo do Node não faz transform de JSX. `React.createElement` evita precisar de bundler só pra isto. */
const h = React.createElement;

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

function HistoryLine({ item }: { item: HistoryItem }): React.ReactElement {
    if (item.role === "tool_call") {
        return h(Box, null, h(Text, { color: theme.textMuted }, "● ", formatToolCall(item.name, item.input)));
    }
    if (item.role === "tool_result") {
        return h(Box, { flexDirection: "column", marginBottom: 1, paddingLeft: 2 }, h(Text, { color: theme.textMuted, dimColor: true }, "⎿ ", formatToolResult(item.name, item.output)));
    }
    if (item.role === "notice") {
        const color = item.tone === "success" ? theme.success : item.tone === "danger" ? theme.danger : theme.warning;
        return h(Box, { marginBottom: 1 }, h(Text, { color }, item.text));
    }
    if (item.role === "usage") {
        return h(Box, { marginBottom: 1 }, h(Text, { color: theme.textMuted, dimColor: true }, formatUsageLine(item.usage)));
    }
    if (item.role === "user") {
        // Inline de propósito (rótulo + texto na MESMA linha, quebrando
        // como um parágrafo só se precisar) — mensagem do usuário costuma
        // ser curta, e "Você:" numa linha sozinha empurrando um "Opa" pra
        // linha de baixo desperdiça uma linha inteira à toa. Ver
        // measureHistoryItem em viewport.ts, tem que medir igual.
        return h(Box, { marginBottom: 1 }, h(Text, null, c.primary.bold("Você:"), " ", item.text));
    }
    // Helena mantém rótulo em linha própria — a resposta é markdown
    // renderizado (pode ter várias linhas, listas, bloco de código), e
    // colar isso direto depois de "Helena: " ficaria estranho.
    return h(Box, { flexDirection: "column", marginBottom: 1 }, h(Text, null, c.accent.bold("Helena") + ":"), h(Text, null, renderMarkdownAnsi(item.text)));
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
                { key: projectId, flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
                h(Text, { color: theme.primary, bold: true }, `Equipe de dev — ${formatProjectSummary(steps)}`),
                ...formatProjectChecklist(steps).map((line, i) => h(Text, { key: i, dimColor: line.startsWith("○") }, line)),
            ),
        ),
    );
}

/** Espelha em LINHAS o que `ProjectProgressPanel` desenha — mesmo texto, mesma largura efetiva (`paddingX:1` tira 2 colunas), pra reservar orçamento certo pro histórico (ver `fitToViewport` em app()). */
function measureProjectPanel(projectSteps: Map<string, ProjectStepsByRole>, columns: number): number {
    if (projectSteps.size === 0) return 0;
    const inner = columns - 2;
    let total = 1; // marginBottom do container externo
    for (const steps of projectSteps.values()) {
        total += 2; // borda round (topo + base)
        total += countWrappedLines(`Equipe de dev — ${formatProjectSummary(steps)}`, inner);
        for (const line of formatProjectChecklist(steps)) total += countWrappedLines(line, inner);
    }
    return total;
}

/** Painel visual do plano do agent (create_plan / update_plan_step) — mostra título, descrição e steps com status. */
function PlanPanel({ plan }: { plan: AgentPlan | null }): React.ReactElement | null {
    if (!plan) return null;

    const statusColor = plan.status === "active" ? theme.primary : plan.status === "completed" ? theme.success : theme.textMuted;
    const statusLabel = plan.status === "active" ? "● ATIVO" : plan.status === "completed" ? "✓ CONCLUÍDO" : "⊘ ARQUIVADO";

    return h(
        Box,
        { flexDirection: "column", marginBottom: 1, borderStyle: "round", borderColor: theme.border, paddingX: 1 },
        h(Box, { gap: 1 },
            h(Text, { color: theme.accent, bold: true }, `Plano: ${plan.title}`),
            h(Text, { color: statusColor, bold: true }, statusLabel),
        ),
        h(Text, { dimColor: true }, plan.description),
        h(Text, null, " "),
        ...plan.steps.map((step, i) => {
            const stepIcon = step.status === "completed" ? "✓"
                : step.status === "in_progress" ? "▶"
                : step.status === "failed" ? "✗"
                : step.status === "cancelled" ? "⊘"
                : "○";
            const stepColor = step.status === "completed" ? theme.success
                : step.status === "in_progress" ? theme.primary
                : step.status === "failed" ? theme.danger
                : step.status === "cancelled" ? theme.warning
                : theme.textMuted;
            const indent = "  ";
            return h(
                Box,
                { key: step.id, flexDirection: "column", marginBottom: i === plan.steps.length - 1 ? 0 : 1 },
                h(Text, { color: stepColor }, `${indent}${stepIcon} ${step.title}`),
                ...(step.description ? [h(Text, { dimColor: true }, `${indent}  ${step.description}`)] : []),
                ...(step.error ? [h(Text, { color: theme.danger }, `${indent}  Erro: ${step.error}`)] : []),
            );
        }),
    );
}

/** Espelha em LINHAS o que `PlanPanel` desenha — pra reservar orçamento certo pro histórico. */
function measurePlanPanel(plan: AgentPlan | null, columns: number): number {
    if (!plan) return 0;
    const inner = columns - 2;
    let total = 1; // marginBottom
    total += 2; // borda round
    total += countWrappedLines(`Plano: ${plan.title}`, inner);
    total += countWrappedLines(plan.description, inner);
    total += 1; // espaço
    for (const step of plan.steps) {
        total += countWrappedLines(`${step.title}`, inner);
        if (step.description) total += countWrappedLines(step.description, inner);
        if (step.error) total += countWrappedLines(`Erro: ${step.error}`, inner);
    }
    return total;
}

function StatusLine({ text }: { text: string }): React.ReactElement {
    return h(Box, { gap: 1 }, h(Text, { color: theme.primary }, h(Spinner, { type: "dots" })), h(Text, { dimColor: true }, text));
}

/** "❯"/spinner + `gap:1` comem ~3 colunas antes do texto de verdade — subtrai como margem de segurança (superestimar é seguro, ver viewport.ts). */
function measureStatusLine(text: string, columns: number): number {
    return countWrappedLines(text, columns - 3);
}

function Composer(props: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; disabled: boolean; resetKey: number }): React.ReactElement {
    return h(
        Box,
        { gap: 1 },
        h(Text, { color: theme.success, bold: true }, "❯"),
        // `key: resetKey` força o TextInput a REMONTAR quando o Tab do menu de
        // comandos preenche `value` programaticamente — sem isto, o cursor
        // interno do ink-text-input (só se ajusta ao digitar, ver seu
        // useEffect) fica parado na posição de ANTES do completar, no meio
        // da palavra (ex: complete pra "/cobranca " mas cursor fica logo
        // depois de "/co") — daí a próxima tecla digitada quebraria a
        // palavra ao meio em vez de continuar no fim. Remontar reinicia o
        // cursor pro fim do valor novo, único jeito de resetar esse estado
        // interno sem prop pra isso.
        h(TextInput, { key: props.resetKey, value: props.value, onChange: props.onChange, onSubmit: props.onSubmit, placeholder: "Escreva sua mensagem...", focus: !props.disabled }),
    );
}

function measureComposer(value: string, columns: number): number {
    return countWrappedLines(value.length > 0 ? value : "Escreva sua mensagem...", columns - 3);
}

/**
 * Sugestões de `/comando` embaixo do composer — só some em duas situações
 * (pedido explícito): apagar a "/" ou digitar algo que já não casa com
 * NENHUM comando (deixa a mensagem virar texto normal/erro de comando
 * desconhecido, igual antes). Sem Esc pra fechar de propósito. Navegação
 * por seta é só conveniência: como a lista já filtra a cada tecla, digitar
 * até sobrar 1 opção e dar Enter sempre funciona mesmo se `\x1b[A/B`
 * chegar fragmentado no pty (mesma lição de select-menu.ts) — Tab/Enter
 * são 1 byte só, não têm essa classe de problema.
 */
function CommandMenu(props: { commands: Command[]; activeIndex: number }): React.ReactElement {
    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
        ...props.commands.map((cmd, i) => {
            const active = i === props.activeIndex;
            const names = [`/${cmd.name}`, ...(cmd.aliases ?? []).map((a) => `/${a}`)].join(", ");
            const pointer = active ? c.primary("❯ ") : "  ";
            const label = active ? c.primary.bold(names) : names;
            return h(Text, { key: cmd.name }, pointer, label, "  ", c.muted(cmd.description));
        }),
        h(Text, { dimColor: true }, "↑↓ navegar · Tab completar · Enter executar"),
    );
}

function measureCommandMenu(commands: Command[], columns: number): number {
    if (commands.length === 0) return 0;
    const inner = columns - 2;
    let total = 2 + 1; // borda (topo+base) + linha de dica
    for (const cmd of commands) {
        const names = [`/${cmd.name}`, ...(cmd.aliases ?? []).map((a) => `/${a}`)].join(", ");
        total += countWrappedLines(`${names}  ${cmd.description}`, inner);
    }
    return total;
}

function ConfirmationPrompt(props: { pending: PendingConfirmation; onAnswer: (approved: boolean) => void }): React.ReactElement {
    useInput((input: string) => {
        const normalized = input.trim().toLowerCase();
        if (normalized === "s") props.onAnswer(true);
        else if (normalized === "n") props.onAnswer(false);
    });

    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: theme.warning, paddingX: 1 },
        h(Text, { color: theme.warning, bold: true }, `Aprovação necessária — ${props.pending.tool}`),
        h(Text, { dimColor: true }, JSON.stringify(props.pending.input, null, 2)),
        h(Text, null, "Aprovar? (s/n)"),
    );
}

function measureConfirmation(pending: PendingConfirmation, columns: number): number {
    const inner = columns - 2;
    return 2 + countWrappedLines(`Aprovação necessária — ${pending.tool}`, inner) + countWrappedLines(JSON.stringify(pending.input, null, 2), inner) + countWrappedLines("Aprovar? (s/n)", inner);
}

/** Dica de rolagem — SEMPRE 1 linha reservada (vazia quando não há o que rolar), pra não criar um ciclo (altura do chrome dependendo de canScrollUp/Down, que só existem DEPOIS de já ter orçado a altura do chrome). */
function scrollHintText(canScrollUp: boolean, canScrollDown: boolean): string {
    if (canScrollUp && canScrollDown) return "↑ PageUp (mais antigas) · PageDown ↓ (mais novas)";
    if (canScrollUp) return "↑ PageUp pra ver mensagens mais antigas";
    if (canScrollDown) return "PageDown ↓ pra voltar pras mensagens mais novas";
    return "";
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
    const [activePlan, setActivePlan] = React.useState<AgentPlan | null>(null);
    const [screen, setScreen] = React.useState<Screen>("chat");
    const [commandMenuIndex, setCommandMenuIndex] = React.useState(0);
    // Incrementado só quando o Tab preenche o composer programaticamente —
    // vira `key` do TextInput (ver Composer) pra forçar o cursor pro fim.
    const [composerResetKey, setComposerResetKey] = React.useState(0);
    // `null` = grudado na mensagem mais nova (padrão). Um NÚMERO é um
    // índice ABSOLUTO (ver viewport.ts#fitToViewport) — fica PARADO
    // mesmo que `history` cresça por trás (mensagem chegando em segundo
    // plano enquanto o usuário lê algo antigo não pode empurrar a tela).
    const [scrollAnchor, setScrollAnchor] = React.useState<number | null>(null);

    // Fullscreen de verdade (ver chat.ts) — `rows-1` de propósito: escrever
    // na última célula da última linha faz vários terminais rolarem uma
    // linha sozinhos (auto-margin), brigando com o apaga-e-redesenha do Ink.
    const { columns, rows } = useWindowSize();
    const usableRows = Math.max(1, rows - 1);

    // O menu só some em DUAS situações, de propósito (pedido explícito):
    // apagar a "/" (inputValue para de começar com "/") ou digitar algo que
    // não casa mais com NENHUM comando (matchCommands fica vazio — inclusive
    // espaço + texto depois de um nome já completo, já que nenhum prefixo
    // bate com "config " sobrando). Nada de Esc, nada de cortar no espaço
    // manualmente — é só "ainda casa com algo?".
    const commandQuery = screen === "chat" && !sending && !pending && inputValue.startsWith("/") ? inputValue.slice(1) : undefined;
    const filteredCommands = commandQuery !== undefined ? matchCommands(commandQuery) : [];
    const showCommandMenu = filteredCommands.length > 0;

    // Reseta a seleção a cada mudança no prefixo — inclusive apagando
    // ("/co" -> "/c") — pra nunca deixar o índice apontando pra fora da
    // lista filtrada nova.
    React.useEffect(() => {
        setCommandMenuIndex(0);
    }, [commandQuery]);

    // Orçamento de linhas pro histórico = tela útil MENOS tudo o mais que
    // aparece embaixo dele (painel de projects, erro, composer/status/
    // confirmação, menu de comando, dica de rolagem). Superestimar aqui é
    // seguro (sobra uma linha em branco); subestimar faz o conteúdo
    // estourar `rows` e o buffer alternativo ROLAR — sem scrollback, isso
    // é conteúdo perdido de vez (ver viewport.ts).
    const liveRegionRows = pending ? measureConfirmation(pending, columns) : sending ? measureStatusLine(statusLine, columns) : measureComposer(inputValue, columns);
    const chromeRows =
        measureProjectPanel(projectSteps, columns) +
        measurePlanPanel(activePlan, columns) +
        (error ? countWrappedLines(`[erro] ${error}`, columns) : 0) +
        liveRegionRows +
        (showCommandMenu ? measureCommandMenu(filteredCommands, columns) : 0) +
        1; // dica de rolagem, sempre reservada
    const availableHistoryRows = Math.max(1, usableRows - chromeRows);

    const historyHeights = React.useMemo(() => history.map((item) => measureHistoryItem(item, columns)), [history, columns]);
    const requestedEnd = scrollAnchor === null ? history.length : scrollAnchor;
    const { start: historyStart, end: historyEnd, canScrollUp, canScrollDown } = fitToViewport(historyHeights, availableHistoryRows, requestedEnd);
    const visibleHistory = history.slice(historyStart, historyEnd);

    // Refs pra ler o valor ATUAL de dentro do callback do WS (que só é
    // registrado uma vez no efeito abaixo) sem precisar reconectar o
    // WebSocket toda vez que `history`/`sessionId` mudam.
    const historyRef = React.useRef(history);
    historyRef.current = history;
    const sessionIdRef = React.useRef(sessionId);
    sessionIdRef.current = sessionId;
    const sendingRef = React.useRef(sending);
    sendingRef.current = sending;

    // Guarda o HUB (não só a inscrição) — telas específicas (detalhe de um
    // Project) leem `subscribeProgress` (estável, ver useCallback abaixo)
    // pra assinar os MESMOS eventos sem abrir outro WebSocket.
    const progressHubRef = React.useRef<ReturnType<typeof connectProgress> | undefined>(undefined);
    const subscribeProgress = React.useCallback((fn: (event: ChatProgressEvent) => void) => progressHubRef.current?.subscribe(fn) ?? (() => {}), []);

    React.useEffect(() => {
        const hub = connectProgress(backendUrl, token);
        progressHubRef.current = hub;
        const unsubscribe = hub.subscribe((event: ChatProgressEvent) => {
            // tool_call/turn_start/tool_stream só fazem sentido DENTRO de um turno que ESTE
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
            } else if (event.type === "tool_stream") {
                if (!sendingRef.current) return;
                // Streaming output from shell command — show latest chunk in status
                const chunk = event.stdoutChunk ?? event.stderrChunk;
                if (chunk) {
                    const lines = chunk.trim().split("\n");
                    const lastLine = lines[lines.length - 1] || "";
                    setStatusLine(`⎿  ${lastLine.slice(0, 120)}${lastLine.length > 120 ? "…" : ""}`);
                }
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
            } else if (event.type === "plan_created") {
                // Plano criado pelo agent — torna-se o plano ativo
                setActivePlan(event.plan);
            } else if (event.type === "plan_updated") {
                // Step do plano atualizado
                setActivePlan((prev) => {
                    if (!prev || prev.id !== event.planId) return prev;
                    const updatedStep = event.step;
                    if (!updatedStep) return prev;
                    return {
                        ...prev,
                        steps: prev.steps.map((s) => (s.id === event.stepId ? updatedStep : s)),
                        updatedAt: event.at,
                    };
                });
            } else if (event.type === "plan_status_changed") {
                // Status do plano alterado
                setActivePlan((prev) => {
                    if (!prev || prev.id !== event.planId) return prev;
                    return { ...prev, status: event.status, updatedAt: event.at };
                });
            }
        });
        return () => {
            unsubscribe();
            progressHubRef.current = undefined;
            hub.close();
        };
    }, [backendUrl, token]);

    useInput((input: string, key: { ctrl: boolean }) => {
        if (key.ctrl && (input === "c" || input === "d")) {
            onDone({ type: "exit" });
        }
    });

    // `ink-text-input` ignora de propósito upArrow/downArrow/tab (ver seu
    // código-fonte) — sobra livre pro menu de `/comando` sem disputar tecla
    // com o composer. Enter fica de fora daqui de propósito: quem decide o
    // Enter é só `handleSubmit`, senão os dois handlers disparariam juntos.
    useInput(
        (_input, key) => {
            if (key.downArrow) {
                setCommandMenuIndex((i) => (i + 1) % filteredCommands.length);
                return;
            }
            if (key.upArrow) {
                setCommandMenuIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
                return;
            }
            if (key.tab) {
                const cmd = filteredCommands[commandMenuIndex];
                if (cmd) {
                    setInputValue(`/${cmd.name} `);
                    setComposerResetKey((k) => k + 1);
                }
            }
        },
        { isActive: showCommandMenu },
    );

    // PageUp/PageDown navegam o histórico — `ink-text-input` já ignora
    // essas teclas (não fazem parte do texto digitado, ver
    // nonAlphanumericKeys no ink), então não competem com o composer.
    // PageUp ancora exatamente no início da janela atual (`historyStart`),
    // revelando a "página" anterior — PageDown avança por essa mesma
    // contagem de itens; ao alcançar o fim, solta a âncora (`null`) e
    // volta a grudar no mais novo sozinho.
    useInput(
        (_input, key) => {
            if (key.pageUp) {
                if (canScrollUp) setScrollAnchor(historyStart);
                return;
            }
            if (key.pageDown && scrollAnchor !== null) {
                const pageSize = Math.max(1, historyEnd - historyStart);
                const nextEnd = historyEnd + pageSize;
                setScrollAnchor(nextEnd >= history.length ? null : nextEnd);
            }
        },
        { isActive: screen === "chat" },
    );

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
        const name = raw.slice(1).trim().toLowerCase();
        const command = findCommand(name);
        if (!command) {
            setHistory((prev) => [...prev, noticeItem(`Comando desconhecido: "${raw}" — digite /help pra ver os comandos disponíveis.`, "warn")]);
            return;
        }
        command.run({
            setScreen,
            pushNotice: (text, tone) => setHistory((prev) => [...prev, noticeItem(text, tone)]),
        });
    }

    function handleSubmit(text: string): void {
        const trimmed = text.trim();
        setInputValue("");
        if (!trimmed || sending || pending) return;
        if (trimmed.startsWith("/")) {
            // Menu aberto (mesmo com match parcial, ex: "/co") -> Enter confirma
            // o item destacado, não o texto cru — assim "/co"+Enter já roda
            // /config sem precisar digitar o nome inteiro.
            const highlighted = showCommandMenu ? filteredCommands[commandMenuIndex] : undefined;
            handleCommand(highlighted ? `/${highlighted.name}` : trimmed);
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

    const onUnauthorized = () => onDone({ type: "relogin", history: historyRef.current, sessionId: sessionIdRef.current });

    // Fullscreen cobre TODA tela, não só o chat — cada tela por baixo (Box
    // sem altura própria) fica com espaço em branco embaixo quando o
    // conteúdo dela é mais curto que o terminal, em vez de deixar o resto
    // da tela vazio fora do controle do Ink (ver chat.ts pro alt-screen).
    const fullScreen = (child: React.ReactElement): React.ReactElement => h(Box, { flexDirection: "column", height: usableRows }, child);

    if (screen === "config") {
        return fullScreen(h(ConfigScreen, { backendUrl, token, onExit: () => setScreen("chat"), onUnauthorized }));
    }
    if (screen === "contacts") {
        return fullScreen(h(ContactsScreen, { backendUrl, token, onExit: () => setScreen("chat"), onUnauthorized }));
    }
    if (screen === "mcp") {
        return fullScreen(h(McpScreen, { backendUrl, token, onExit: () => setScreen("chat"), onUnauthorized }));
    }
    if (screen === "channels") {
        return fullScreen(h(ChannelsScreen, { localPort: config.localPort, onExit: () => setScreen("chat") }));
    }
    if (screen === "usage") {
        return fullScreen(h(UsageScreen, { backendUrl, token, onExit: () => setScreen("chat"), onUnauthorized }));
    }
    if (screen === "billing") {
        return fullScreen(h(BillingScreen, { backendUrl, token, onExit: () => setScreen("chat"), onUnauthorized }));
    }
    if (screen === "projects") {
        return fullScreen(h(ProjectsScreen, { backendUrl, token, onExit: () => setScreen("chat"), onUnauthorized, subscribeProgress }));
    }

    let liveRegion: React.ReactElement;
    if (pending) liveRegion = h(ConfirmationPrompt, { pending, onAnswer: handleConfirmation });
    else if (sending) liveRegion = h(StatusLine, { text: statusLine });
    else liveRegion = h(Composer, { value: inputValue, onChange: setInputValue, onSubmit: handleSubmit, disabled: false, resetKey: composerResetKey });

    return h(
        Box,
        { flexDirection: "column", height: usableRows },
        // `flexGrow:1`: quando o histórico visível é mais curto que o
        // orçamento (`availableHistoryRows`), o Yoga estica esta caixa em
        // vez de deixar o composer grudado logo abaixo da última mensagem
        // — é isso que fixa a escrita na BASE da tela mesmo com pouco
        // conteúdo. Como as mensagens já vêm fatiadas pra caber (nunca
        // mais que `availableHistoryRows`), esticar aqui nunca estoura
        // `usableRows` no total.
        h(Box, { flexDirection: "column", flexGrow: 1 }, ...visibleHistory.map((item) => h(HistoryLine, { key: item.id, item }))),
        h(Text, { dimColor: true }, scrollHintText(canScrollUp, canScrollDown)),
        h(ProjectProgressPanel, { projectSteps }),
        h(PlanPanel, { plan: activePlan }),
        error ? h(Text, { color: "red" }, `[erro] ${error}`) : null,
        liveRegion,
        showCommandMenu ? h(CommandMenu, { commands: filteredCommands, activeIndex: commandMenuIndex }) : null,
    );
}
