import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import TextInput from "ink-text-input";
import { Loader } from "./loader.ts";
import { applyMention, findMentionToken, listProjectFiles, matchFiles } from "./file-mentions.ts";
import { readGitBranch } from "./git-branch.ts";
import { appendInputHistory, loadInputHistory, newerEntry, NOT_NAVIGATING, olderEntry, type HistoryNav } from "./input-history.ts";
import { connectLocalWs } from "./local-ws-client.ts";
import { statusBarParts } from "./status-bar.ts";
import type { ClientState } from "../../local-api/status-bus.ts";
import { loadCliPrefs, saveCliPrefs } from "./cli-prefs.ts";
import { SettingsModal, type SettingsTarget } from "./settings-modal.ts";
import { CommandPaletteModal } from "./command-palette.ts";
import { PermissionsScreen } from "./permissions-screen.ts";
import { stripMouse, useMouse, type MouseEvent } from "./mouse.ts";
import { getSessionHistory, listSessionSummaries, type SessionSummary } from "../api/sessions.ts";
import { formatWhen, historyEntriesToItems, sessionLabel, SessionsScreen } from "./sessions-screen.ts";
import { measurePermissionDialog, PermissionDialog, type PermissionDecision } from "./permission-dialog.ts";
import { truncateToWidth } from "./worktree.ts";
import { logout as logoutApi, resolveInterrupt, sendMessage, UnauthorizedError, type PendingConfirmation, type SendMessageResult } from "../backend.ts";
import { loadSession } from "../session-store.ts";
import { findCommand, matchCommands, type Command, type CommandContext, type Screen } from "./commands.ts";
import { ConfigScreen } from "./config-screen.ts";
import { ChannelsScreen } from "./channels-screen.ts";
import { ContactsScreen } from "./contacts-screen.ts";
import { McpScreen } from "./mcp-screen.ts";
import { BillingScreen } from "./billing-screen.ts";
import { ProjectsScreen } from "./projects-screen.ts";
import { UsageScreen } from "./usage-screen.ts";
import { TelemetryScreen } from "./telemetry-screen.ts";
import { config } from "../../config.ts";
import { formatToolCall, formatToolResult } from "./format-tool-call.ts";
import { formatUsageLine } from "./format-usage.ts";
import { historyItem, noticeItem, toolCallItem, toolResultItem, usageItem, type HistoryItem } from "./history-item.ts";
import { connectProgress, type ChatProgressEvent, type AgentPlan, type PlanStep } from "./progress-client.ts";
import { formatProjectChecklist, formatProjectSummary, type ProjectStepsByRole } from "./project-progress.ts";
import { renderMarkdownAnsi } from "./render-markdown.ts";
import { countWrappedLines, fitToViewport, measureHistoryItem } from "./viewport.ts";
import { Banner } from "./banner.ts";
import { bg, c, theme, panel, MESSAGE_PADDING_X, MESSAGE_PADDING_Y, SPACE } from "./theme.ts";

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
        return h(Box, { flexDirection: "column", marginBottom: SPACE.tight, paddingLeft: SPACE.loose }, h(Text, { color: theme.textMuted }, "⎿ ", formatToolResult(item.name, item.output)));
    }
    // Avisos e mensagens são CAIXAS de fundo colorido (sem bordas) — ver theme.ts. measureHistoryItem (viewport.ts)
    // mede com os mesmos MESSAGE_PADDING_*; mudou o layout aqui, muda lá.
    const box = (background: string, paddingY = MESSAGE_PADDING_Y): { marginBottom: number; backgroundColor: string; paddingX: number; paddingY: number } => ({
        marginBottom: SPACE.tight,
        backgroundColor: background,
        paddingX: MESSAGE_PADDING_X,
        paddingY,
    });
    if (item.role === "notice") {
        return h(Box, { marginBottom: SPACE.tight }, h(Banner, { tone: item.tone, text: item.text }));
    }
    if (item.role === "usage") {
        return h(Box, { marginBottom: SPACE.tight }, h(Text, { color: theme.textMuted }, formatUsageLine(item.usage)));
    }
    if (item.role === "user") {
        // Inline de propósito (rótulo + texto na MESMA linha, quebrando como um parágrafo só se precisar).
        return h(Box, box(bg.user), h(Text, null, c.primary.bold("Você:"), " ", item.text));
    }
    // Helena: também inline (rótulo + resposta na mesma linha; o markdown segue quebrando em várias linhas normalmente).
    return h(Box, box(bg.helena), h(Text, null, c.accent.bold("Helena:"), " ", renderMarkdownAnsi(item.text)));
}

/** Checklist ao vivo de Project(s) da equipe de dev em andamento — some sozinho quando o Project termina (o resultado final vira um item "notice" permanente no histórico, ver ChatProgressEvent#project_event). Raramente mais de um Project por vez, mas o Map suporta. */
function ProjectProgressPanel({ projectSteps }: { projectSteps: Map<string, ProjectStepsByRole> }): React.ReactElement | null {
    if (projectSteps.size === 0) return null;

    return h(
        Box,
        { flexDirection: "column", marginBottom: SPACE.tight },
        ...[...projectSteps.entries()].map(([projectId, steps]) =>
            h(
                Box,
                { key: projectId, flexDirection: "column", ...panel("border") },
                h(Text, { color: theme.primary, bold: true }, `Equipe de dev — ${formatProjectSummary(steps)}`),
                ...formatProjectChecklist(steps).map((line, i) => h(Text, { key: i, color: line.startsWith("○") ? theme.textMuted : undefined }, line)),
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
        { flexDirection: "column", marginBottom: SPACE.tight, ...panel("border") },
        h(Box, { gap: SPACE.tight },
            h(Text, { color: theme.accent, bold: true }, `Plano: ${plan.title}`),
            h(Text, { color: statusColor, bold: true }, statusLabel),
        ),
        h(Text, { color: theme.textMuted }, plan.description),
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
                ...(step.description ? [h(Text, { color: theme.textMuted }, `${indent}  ${step.description}`)] : []),
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
    return h(Loader, { text });
}

/** "❯"/spinner + `gap:1` comem ~3 colunas antes do texto de verdade — subtrai como margem de segurança (superestimar é seguro, ver viewport.ts). */
function measureStatusLine(text: string, columns: number): number {
    return countWrappedLines(text, columns - 3);
}

function Composer(props: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; disabled: boolean; resetKey: number }): React.ReactElement {
    return h(
        Box,
        // Caixa em volta do input: borda (1 col cada lado) + paddingX 1 => 4 colunas e 2 linhas
        // a mais que o composer sem caixa — measureComposer abaixo desconta as duas coisas.
        { ...panel("border") },
        // marginRight em vez de `gap`: com texto longo (quebrando) o gap sumia e o "❯" colava na 1ª letra.
        h(Box, { flexShrink: 0, marginRight: SPACE.tight }, h(Text, { color: theme.success, bold: true }, "❯")),
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

/** Texto útil = colunas - 4 (borda + padding da caixa) - 3 ("❯" + gap + margem de segurança); +2 linhas de borda. */
function measureComposer(value: string, columns: number): number {
    return countWrappedLines(value.length > 0 ? value : "Escreva sua mensagem...", columns - 7) + 2;
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
        { flexDirection: "column", ...panel("raised") },
        ...props.commands.map((cmd, i) => {
            const active = i === props.activeIndex;
            const names = `/${cmd.name}`;
            const pointer = active ? c.primary("❯ ") : "  ";
            const label = active ? c.primary.bold(names) : names;
            return h(Text, { key: cmd.name }, pointer, label, "  ", c.muted(cmd.description));
        }),
        h(Text, { color: theme.textMuted }, "↑↓ navegar · Tab completar · Enter executar"),
    );
}

function measureCommandMenu(commands: Command[], columns: number): number {
    if (commands.length === 0) return 0;
    const inner = columns - 2;
    let total = 2 + 1; // borda (topo+base) + linha de dica
    for (const cmd of commands) {
        const names = `/${cmd.name}`;
        total += countWrappedLines(`${names}  ${cmd.description}`, inner);
    }
    return total;
}

/** Sugestões de `@arquivo` embaixo do composer — mesmo desenho do CommandMenu; cada linha é truncada pra nunca quebrar (altura = 2 + n + 1, ver measureMentionMenu). */
function MentionMenu(props: { files: string[]; activeIndex: number; columns: number }): React.ReactElement {
    const width = Math.max(4, props.columns - 8);
    return h(
        Box,
        { flexDirection: "column", ...panel("raised") },
        ...props.files.map((file, i) =>
            i === props.activeIndex ? h(Text, { key: file, color: theme.primary, bold: true }, `❯ ${truncateToWidth(file, width)}`) : h(Text, { key: file }, `  ${truncateToWidth(file, width)}`),
        ),
        h(Text, { color: theme.textMuted }, "↑↓ navegar · Tab/Enter completar"),
    );
}

function measureMentionMenu(files: string[]): number {
    return files.length === 0 ? 0 : 2 + files.length + 1;
}

/** Rodapé de 1 linha (máquina · branch · pasta · tokens · sessão) + alertas à direita. Ver status-bar.ts. */
function StatusBar(props: { info: Parameters<typeof statusBarParts>[0]; width: number }): React.ReactElement {
    // Fundo `panel` (mais escuro que o chat) com 1 coluna de respiro de cada lado — sem linha separando.
    const { main, alert } = statusBarParts(props.info, props.width - 2);
    return h(Box, { justifyContent: "space-between", width: props.width, backgroundColor: bg.panel, paddingX: SPACE.tight }, h(Text, { color: theme.textMuted, wrap: "truncate" }, main), alert ? h(Text, { color: theme.warning, wrap: "truncate" }, alert) : null);
}

function shortPath(cwd: string): string {
    const home = process.env.HOME ?? "";
    return home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;
}

/** Largura TOTAL da sidebar (inclui a borda direita). Some sozinha em terminal estreito — ver MIN_COLUMNS_FOR_SIDEBAR. */
const SIDEBAR_WIDTH = 30;
const MIN_COLUMNS_FOR_SIDEBAR = 100;

/** Linhas fixas antes da lista clicável: título(0) + path(1) + linha em branco(2) + "+ Nova sessão"(3). */
const SIDEBAR_NEW_SESSION_ROW = 3;
const SIDEBAR_SESSIONS_START_ROW = 4;

/** "prévia da mensagem · hoje 14:32", cortando só a prévia (o horário nunca é cortado — é o que ajuda a diferenciar duas conversas com prévia parecida). */
function sidebarSessionLine(session: SessionSummary, width: number): string {
    const when = formatWhen(session.updatedAt);
    const suffix = when ? ` · ${when}` : "";
    return truncateToWidth(sessionLabel(session), Math.max(1, width - suffix.length)) + suffix;
}

/**
 * Sidebar de sessões à esquerda (`/sidebar` esconde/mostra) — substitui a árvore de arquivos (2026-09-22, pedido do
 * dono: "remover a tree, deixar só path, lista de sessões selecionáveis e criar nova sessão", clicável por mouse em
 * vez de teclado pra não disputar ↑↓ com a navegação de histórico do composer). Altura fixa e cada linha truncada
 * (nunca quebra) — mesma restrição de layout que a árvore antiga já tinha.
 */
function Sidebar({
    cwd,
    sessions,
    activeSessionId,
    height,
    interactive,
    onSelectSession,
    onNewSession,
    onOpenAllSessions,
}: {
    cwd: string;
    sessions: SessionSummary[];
    activeSessionId?: string;
    height: number;
    /** `false` enquanto um modal (ex: configurações) cobre a sidebar — ela continua visível por baixo, mas clique não deve fazer nada (ver comentário no App sobre `screen === "settings"`). */
    interactive: boolean;
    onSelectSession: (session: SessionSummary) => void;
    onNewSession: () => void;
    onOpenAllSessions: () => void;
}): React.ReactElement {
    const contentWidth = SIDEBAR_WIDTH - 3; // paddingX 1 (esq/dir) + 1 de folga
    const sessionRows = Math.max(0, height - SIDEBAR_SESSIONS_START_ROW);
    const overflow = sessions.length > sessionRows;
    const visibleCount = overflow ? Math.max(0, sessionRows - 1) : sessions.length;
    const visible = sessions.slice(0, visibleCount);
    const home = process.env.HOME ?? "";
    const shownPath = home && cwd.startsWith(home) ? `~${cwd.slice(home.length)}` : cwd;

    useMouse((event: MouseEvent) => {
        if (event.type !== "press" || event.button !== "left" || event.x >= SIDEBAR_WIDTH) return;
        if (event.y === SIDEBAR_NEW_SESSION_ROW) onNewSession();
        else if (overflow && event.y === SIDEBAR_SESSIONS_START_ROW + visibleCount) onOpenAllSessions();
        else {
            const index = event.y - SIDEBAR_SESSIONS_START_ROW;
            if (index >= 0 && index < visible.length) onSelectSession(visible[index]!);
        }
    }, interactive);

    return h(
        Box,
        { flexDirection: "column", width: SIDEBAR_WIDTH, height, backgroundColor: bg.panel, paddingX: SPACE.tight },
        h(Text, { color: theme.primary, bold: true, wrap: "truncate" }, "Sessões"),
        h(Text, { color: theme.textMuted, wrap: "truncate-start" }, shownPath),
        h(Text, null, " "),
        h(Text, { color: theme.success, wrap: "truncate" }, truncateToWidth("+ Nova sessão", contentWidth)),
        ...(visible.length > 0
            ? visible.map((session) =>
                  h(
                      Text,
                      { key: session.id, wrap: "truncate", color: session.id === activeSessionId ? theme.primary : undefined, bold: session.id === activeSessionId },
                      sidebarSessionLine(session, contentWidth),
                  ),
              )
            : [h(Text, { key: "empty", color: theme.textMuted }, "(nenhuma conversa)")]),
        overflow ? h(Text, { key: "overflow", color: theme.textMuted, wrap: "truncate" }, truncateToWidth(`… +${sessions.length - visibleCount} conversas`, contentWidth)) : null,
    );
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
    // Tela aberta a partir do menu de configurações volta pra ele ao apertar Esc (e não pro chat).
    const [returnTo, setReturnTo] = React.useState<Screen>("chat");
    function leaveScreen(): void {
        setScreen(returnTo);
        setReturnTo("chat");
    }
    function openFromSettings(target: SettingsTarget): void {
        setReturnTo("settings");
        setScreen(({ tokens: "config", permissions: "permissions", usage: "usage", billing: "billing", contacts: "contacts", mcp: "mcp", channels: "channels", projects: "projects", sessions: "sessions", "telemetry-logs": "telemetry" } as const)[target]);
    }
    const [commandMenuIndex, setCommandMenuIndex] = React.useState(0);
    // Paleta de comandos (Ctrl+P) — modal sobre o chat, mesmo padrão do menu de configurações (`screen === "settings"`
    // abaixo), mas SEM entrar no state machine de `Screen`: ela só existe em cima de "chat" (nunca substitui uma
    // tela cheia), então um boolean à parte evita todo o vaivém de `returnTo`/`leaveScreen` que aquele mecanismo
    // precisa pra saber pra onde voltar.
    const [paletteOpen, setPaletteOpen] = React.useState(false);
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

    // Sidebar de sessões (`/sidebar`). `mainColumns` é a largura REAL do chat — toda medição de altura
    // abaixo usa ela, não `columns`, senão o histórico estoura as linhas (ver viewport.ts).
    const [sidebarOpen, setSidebarOpen] = React.useState(() => loadCliPrefs().sidebar ?? true);
    function changeSidebar(on: boolean): void {
        setSidebarOpen(on);
        saveCliPrefs({ sidebar: on }); // lembra entre sessões do helena (só desta máquina)
    }
    // O menu de configurações é um modal SOBRE o chat — o layout de trás (inclusive a sidebar) não muda enquanto ele está aberto, mas fica INTERATIVA só em "chat" (ver prop `interactive` do Sidebar) — clique não deve atravessar o modal.
    const sidebarVisible = sidebarOpen && (screen === "chat" || screen === "settings") && columns >= MIN_COLUMNS_FOR_SIDEBAR;
    // A paleta só abre em cima de "chat" (ver useInput do Ctrl+P) — não precisa entrar na condição acima, ela já vale.
    const mainColumns = sidebarVisible ? columns - SIDEBAR_WIDTH : columns;
    const [sidebarSessions, setSidebarSessions] = React.useState<SessionSummary[]>([]);
    // Relê ao começar/terminar cada turno (pode ter mudado a prévia/horário desta própria conversa) e a cada 5 s
    // enquanto visível (outra sessão pode ter avançado enquanto esta fica ociosa); só troca o estado se a lista
    // mudou — sem re-render à toa. Falha de rede não derruba o chat (mesma tolerância que a árvore antiga tinha pra
    // erro de leitura de disco) — a sidebar só fica com a última lista boa.
    React.useEffect(() => {
        if (!sidebarVisible) return;
        let cancelled = false;
        const refresh = (): void => {
            listSessionSummaries(backendUrl, token, 20)
                .then((next) => {
                    if (cancelled) return;
                    setSidebarSessions((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
                })
                .catch((err: unknown) => {
                    if (err instanceof UnauthorizedError) onUnauthorized();
                });
        };
        refresh();
        const timer = setInterval(refresh, 5000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [sending, sidebarVisible, backendUrl, token]);

    // Barra de status: tokens acumulados da conversa, branch e estado dos canais (WS do daemon local).
    const [totals, setTotals] = React.useState({ tokensIn: 0, tokensOut: 0, turns: 0 });
    const [branch, setBranch] = React.useState(() => readGitBranch(props.invocationCwd));
    const [clientState, setClientState] = React.useState<ClientState | undefined>(undefined);
    React.useEffect(() => {
        const refresh = (): void => setBranch(readGitBranch(props.invocationCwd));
        const timer = setInterval(refresh, 5000);
        return () => clearInterval(timer);
    }, [props.invocationCwd]);
    React.useEffect(() => connectLocalWs(config.localPort, (state) => setClientState({ ...state })), []);

    // Esc / Ctrl+C: `abortRef` cancela o `fetch` do turno em andamento (o cliente PARA DE ESPERAR — o servidor pode
    // terminar o turno sozinho, ver `orphanTurnRef`). Ctrl+C sai só na 2ª vez em 2 s.
    const abortRef = React.useRef<AbortController | undefined>(undefined);
    const orphanTurnRef = React.useRef(false);
    const orphanWarnedRef = React.useRef(false);
    const lastCtrlCRef = React.useRef(0);
    const [exitHint, setExitHint] = React.useState(false);

    // Histórico do input (↑/↓): persistido em disco; `navRef` diz se estamos navegando (e o rascunho a restaurar).
    const inputHistoryRef = React.useRef<string[] | undefined>(undefined);
    if (inputHistoryRef.current === undefined) inputHistoryRef.current = loadInputHistory();
    const navRef = React.useRef<HistoryNav>(NOT_NAVIGATING);
    /** Digitou de verdade (não foi ↑/↓): sai do modo navegação. */
    function handleInputChange(value: string): void {
        navRef.current = NOT_NAVIGATING;
        setInputValue(stripMouse(value)); // sequência de mouse solta (toque rápido) nunca entra na mensagem
    }

    // O menu só some em DUAS situações, de propósito (pedido explícito):
    // apagar a "/" (inputValue para de começar com "/") ou digitar algo que
    // não casa mais com NENHUM comando (matchCommands fica vazio — inclusive
    // espaço + texto depois de um nome já completo, já que nenhum prefixo
    // bate com "config " sobrando). Nada de Esc, nada de cortar no espaço
    // manualmente — é só "ainda casa com algo?".
    const commandQuery = screen === "chat" && !sending && !pending && !paletteOpen && inputValue.startsWith("/") ? inputValue.slice(1) : undefined;
    const filteredCommands = commandQuery !== undefined ? matchCommands(commandQuery) : [];
    const showCommandMenu = filteredCommands.length > 0;

    // Autocomplete de `@arquivo`: só no chat, fora de turno/confirmação e sem competir com o menu de `/comando`.
    const mentionToken = screen === "chat" && !sending && !pending && !paletteOpen && !showCommandMenu ? findMentionToken(inputValue) : undefined;
    const fileIndexRef = React.useRef<{ files: string[]; at: number } | undefined>(undefined);
    const mentionMatches = React.useMemo(() => {
        if (mentionToken === undefined) return [];
        const now = Date.now();
        if (!fileIndexRef.current || now - fileIndexRef.current.at > 10_000) fileIndexRef.current = { files: listProjectFiles(props.invocationCwd), at: now };
        return matchFiles(fileIndexRef.current.files, mentionToken.query, 6);
    }, [mentionToken?.query, mentionToken !== undefined, props.invocationCwd]);
    const showMentionMenu = mentionMatches.length > 0;
    const [mentionIndex, setMentionIndex] = React.useState(0);
    React.useEffect(() => {
        setMentionIndex(0);
    }, [mentionToken?.query]);
    function completeMention(): void {
        const file = mentionMatches[mentionIndex];
        if (!mentionToken || !file) return;
        setInputValue(applyMention(inputValue, mentionToken, file));
        setComposerResetKey((k) => k + 1);
    }

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
    const liveRegionRows = pending ? measurePermissionDialog(pending, mainColumns) : sending ? measureStatusLine(statusLine, mainColumns) : measureComposer(inputValue, mainColumns);
    const chromeRows =
        measureProjectPanel(projectSteps, mainColumns) +
        measurePlanPanel(activePlan, mainColumns) +
        (error ? countWrappedLines(`[erro] ${error}`, mainColumns) : 0) +
        liveRegionRows +
        (showCommandMenu ? measureCommandMenu(filteredCommands, mainColumns) : 0) +
        (showMentionMenu ? measureMentionMenu(mentionMatches) : 0) +
        1 + // dica de rolagem, sempre reservada
        1; // barra de status, sempre 1 linha
    const availableHistoryRows = Math.max(1, usableRows - chromeRows);

    const historyHeights = React.useMemo(() => history.map((item) => measureHistoryItem(item, mainColumns)), [history, mainColumns]);
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
            } else if (event.type === "turn_end" || event.type === "turn_error") {
                if (orphanTurnRef.current && !sendingRef.current) {
                    orphanTurnRef.current = false;
                    setHistory((prev) => [...prev, noticeItem("O turno interrompido terminou no servidor (a resposta ficou salva na sessão dele). Pode continuar.", "success")]);
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

    function abortTurn(): void {
        if (!abortRef.current) return;
        orphanTurnRef.current = true;
        orphanWarnedRef.current = false;
        abortRef.current.abort();
    }

    useInput((input: string, key: { ctrl: boolean; escape?: boolean }) => {
        if (key.ctrl && input === "d") {
            onDone({ type: "exit" });
            return;
        }
        // Só abre/fecha em cima do chat de verdade — nas telas cheias (Contatos/MCP/etc) cada uma já tem seu
        // próprio Esc/atalho, e abrir a paleta por cima delas exigiria o mesmo `returnTo` que o menu de
        // configurações usa (ver comentário no state acima) só pra um atalho que "/" já cobre em qualquer tela.
        if (key.ctrl && input === "p") {
            if (screen === "chat" && !sendingRef.current && !pending) setPaletteOpen((open) => !open);
            return;
        }
        if (key.ctrl && input === "c") {
            const now = Date.now();
            if (now - lastCtrlCRef.current < 2000) {
                onDone({ type: "exit" });
                return;
            }
            lastCtrlCRef.current = now;
            if (sendingRef.current) abortTurn();
            setExitHint(true);
            setTimeout(() => setExitHint(false), 2000);
            return;
        }
        if (key.escape && sendingRef.current) abortTurn();
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

    useInput(
        (_input, key) => {
            if (key.downArrow) setMentionIndex((i) => (i + 1) % mentionMatches.length);
            else if (key.upArrow) setMentionIndex((i) => (i - 1 + mentionMatches.length) % mentionMatches.length);
            else if (key.tab) completeMention();
        },
        { isActive: showMentionMenu },
    );

    useInput(
        (_input, key) => {
            const entries = inputHistoryRef.current ?? [];
            const step = key.upArrow ? olderEntry(entries, navRef.current, inputValue) : key.downArrow ? newerEntry(entries, navRef.current) : undefined;
            if (!step) return;
            navRef.current = step.nav;
            setInputValue(step.value);
            setComposerResetKey((k) => k + 1); // cursor no fim do texto recuperado
        },
        { isActive: screen === "chat" && !sending && !pending && !paletteOpen && !showCommandMenu && !showMentionMenu },
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
        { isActive: screen === "chat" && !paletteOpen },
    );

    async function runTurn(action: (signal: AbortSignal) => Promise<SendMessageResult>): Promise<void> {
        const controller = new AbortController();
        abortRef.current = controller;
        setSending(true);
        setStatusLine("Helena está pensando...");
        setError(undefined);
        try {
            const result = await action(controller.signal);
            setSessionId(result.sessionId);
            // Resultado de tool só existe DEPOIS que o turno inteiro termina (ver toolActivity em backend.ts)
            // — entra em lote aqui, depois de todas as chamadas ao vivo já mostradas, antes da resposta final.
            // Turno PAROU numa confirmação (PermissionDialog): a tool ainda não tem resultado e o texto é só o
            // placeholder do backend — o diálogo já explica o estado, então nenhum dos dois entra no histórico.
            const stoppedForPermission = (result.pending?.length ?? 0) > 0;
            const toolResults = (result.toolActivity ?? []).filter((entry) => !(stoppedForPermission && entry.output === undefined)).map((entry) => toolResultItem(entry.name, entry.output));
            const showText = !(stoppedForPermission && result.text.startsWith("(sem texto"));
            setHistory((prev) => [...prev, ...toolResults, ...(showText ? [historyItem("assistant", result.text)] : []), ...(result.usage ? [usageItem(result.usage)] : [])]);
            setPending(result.pending?.[0]);
            if (result.usage) {
                const usage = result.usage;
                setTotals((prev) => ({ tokensIn: prev.tokensIn + (usage.inputTokens ?? 0), tokensOut: prev.tokensOut + (usage.outputTokens ?? 0), turns: prev.turns + 1 }));
            }
        } catch (err) {
            if (controller.signal.aborted) {
                setHistory((prev) => [...prev, noticeItem("Interrompido — parei de esperar. O servidor pode terminar esse turno sozinho; te aviso quando acabar.", "warn")]);
                return;
            }
            if (err instanceof UnauthorizedError) {
                onDone({ type: "relogin", history: historyRef.current, sessionId: sessionIdRef.current });
                return;
            }
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSending(false);
            if (abortRef.current === controller) abortRef.current = undefined;
        }
    }

    /** Zera tudo que pertence à conversa atual (histórico da tela, sessão, totais, plano, rolagem, turno órfão). */
    function resetConversation(): void {
        setHistory([]);
        setSessionId(undefined);
        setTotals({ tokensIn: 0, tokensOut: 0, turns: 0 });
        setActivePlan(null);
        setScrollAnchor(null);
        setError(undefined);
        orphanTurnRef.current = false;
        orphanWarnedRef.current = false;
        navRef.current = NOT_NAVIGATING;
    }

    function newSession(): void {
        resetConversation();
        setHistory([noticeItem("Nova conversa. A anterior continua em /sessoes.", "success")]);
    }

    /**
     * `/logout`: revoga a sessão (best-effort — falha de rede não deve travar quem só quer sair) e devolve pro
     * mesmo caminho de "token expirado" (`onDone({type:"relogin"})`, ver `onUnauthorized` acima e `chat.ts#main`,
     * que já limpa o arquivo de sessão e chama `interactiveLogin()` sozinho). Histórico/sessionId NÃO viajam pro
     * próximo login — ao contrário de `onUnauthorized` (mesmo token, sessão só expirou), aqui é o DONO pedindo pra
     * trocar de conta; resumir a conversa de um usuário na sessão de outro não faz sentido, e o servidor recusaria
     * (`ChatSession` é escopada por `userId`) — bug real evitado antes de existir.
     */
    function logout(): void {
        const stored = loadSession();
        if (stored?.refreshToken) void logoutApi(backendUrl, stored.refreshToken).catch(() => undefined);
        onDone({ type: "relogin", history: [], sessionId: undefined });
    }

    /** Retoma uma sessão: volta pro chat na hora e carrega as últimas mensagens (a Helena já tem o contexto completo no servidor). */
    async function resumeSession(session: SessionSummary): Promise<void> {
        setScreen("chat");
        setReturnTo("chat"); // veio do menu de configurações? não volta pra ele depois de retomar a conversa
        resetConversation();
        setSessionId(session.id);
        try {
            const page = await getSessionHistory(backendUrl, token, session.id);
            const items = historyEntriesToItems(page.entries);
            const older = page.total - page.entries.length;
            const banner = noticeItem(older > 0 ? `Conversa retomada — mostrando as últimas ${page.entries.length} de ${page.total} mensagens.` : "Conversa retomada.", "success");
            setHistory([banner, ...items]);
        } catch (err) {
            if (err instanceof UnauthorizedError) {
                onDone({ type: "relogin", history: historyRef.current, sessionId: session.id });
                return;
            }
            setHistory([noticeItem(`Não consegui carregar o histórico (${err instanceof Error ? err.message : String(err)}). A conversa continua de onde parou.`, "warn")]);
        }
    }

    const commandContext: CommandContext = { setScreen, pushNotice: (text, tone) => setHistory((prev) => [...prev, noticeItem(text, tone)]), toggleSidebar: () => changeSidebar(!sidebarOpen), newSession, logout };

    function handleCommand(raw: string): void {
        const name = raw.slice(1).trim().toLowerCase();
        const command = findCommand(name);
        if (!command) {
            setHistory((prev) => [...prev, noticeItem(`Comando desconhecido: "${raw}" — digite /help pra ver os comandos disponíveis.`, "warn")]);
            return;
        }
        command.run(commandContext);
    }

    /** Comando escolhido na paleta (Ctrl+P) — roda de dentro de QUALQUER seção (Conta/Integrações/etc, não só as
     * navegáveis a partir do chat), então volta pro chat por padrão antes de rodar; se o comando pedir uma tela
     * própria (`config`, `contatos`, etc.), `command.run` chama `setScreen` DEPOIS e vence (mesmo tick de estado,
     * a última chamada pra um `useState` é a que fica) — comandos sem tela própria (`novo`, `sidebar`, `help`)
     * simplesmente terminam no chat, que é exatamente onde "/" já os deixaria hoje. */
    function runFromPalette(command: Command): void {
        setPaletteOpen(false);
        setScreen("chat");
        command.run(commandContext);
    }

    function handleSubmit(text: string): void {
        // Menu de @arquivo aberto: Enter completa o item destacado em vez de enviar.
        if (showMentionMenu && mentionToken) {
            completeMention();
            return;
        }
        // "\" no fim + Enter = quebra de linha (Shift+Enter não chega ao terminal sem o protocolo do Kitty).
        if (text.endsWith("\\")) {
            navRef.current = NOT_NAVIGATING;
            setInputValue(`${text.slice(0, -1)}\n`);
            setComposerResetKey((k) => k + 1);
            return;
        }
        const trimmed = text.trim();
        // Turno interrompido que o servidor ainda pode estar terminando: mandar outra mensagem na MESMA sessão
        // poderia rodar dois turnos ao mesmo tempo. Devolve o texto e avisa; Enter de novo força o envio.
        if (trimmed && !sending && !pending && orphanTurnRef.current && !trimmed.startsWith("/")) {
            if (!orphanWarnedRef.current) {
                orphanWarnedRef.current = true;
                setInputValue(text);
                setComposerResetKey((k) => k + 1);
                setHistory((prev) => [...prev, noticeItem("O turno interrompido ainda pode estar rodando no servidor. Aguarde o aviso de conclusão — ou aperte Enter de novo para enviar mesmo assim.", "warn")]);
                return;
            }
            orphanTurnRef.current = false;
        }
        setInputValue("");
        navRef.current = NOT_NAVIGATING;
        if (!trimmed || sending || pending) return;
        inputHistoryRef.current = appendInputHistory(inputHistoryRef.current ?? [], trimmed);
        if (trimmed.startsWith("/")) {
            // Menu aberto (mesmo com match parcial, ex: "/co") -> Enter confirma
            // o item destacado, não o texto cru — assim "/co"+Enter já roda
            // /config sem precisar digitar o nome inteiro.
            const highlighted = showCommandMenu ? filteredCommands[commandMenuIndex] : undefined;
            handleCommand(highlighted ? `/${highlighted.name}` : trimmed);
            return;
        }
        setHistory((prev) => [...prev, historyItem("user", trimmed)]);
        void runTurn((signal) => sendMessage(backendUrl, token, { text: trimmed, sessionId, cwd: invocationCwd, machineName }, signal));
    }

    function handleConfirmation(decision: PermissionDecision): void {
        if (!pending || !sessionId) return;
        const current = pending;
        const activeSessionId = sessionId;
        const approved = decision !== "reject";
        setPending(undefined);
        // "só desta vez" manda remember:false (o backend NÃO grava o comando); "sempre permitir" manda true.
        void runTurn((signal) => resolveInterrupt(backendUrl, token, activeSessionId, current.tool, current.ref, approved, approved ? undefined : "Recusado pelo usuário no CLI.", approved ? decision === "always" : undefined, signal));
    }

    const onUnauthorized = () => onDone({ type: "relogin", history: historyRef.current, sessionId: sessionIdRef.current });

    // Fullscreen cobre TODA tela, não só o chat — cada tela por baixo (Box
    // sem altura própria) fica com espaço em branco embaixo quando o
    // conteúdo dela é mais curto que o terminal, em vez de deixar o resto
    // da tela vazio fora do controle do Ink (ver chat.ts pro alt-screen).
    const fullScreen = (child: React.ReactElement): React.ReactElement => h(Box, { flexDirection: "column", height: usableRows, width: columns, backgroundColor: bg.base }, child);

    if (screen === "sessions") {
        return fullScreen(
            h(SessionsScreen, { backendUrl, token, activeSessionId: sessionId, onPick: (session: SessionSummary) => void resumeSession(session), onDeleteActive: newSession, onExit: leaveScreen, onUnauthorized }),
        );
    }

    if (screen === "permissions") {
        return fullScreen(h(PermissionsScreen, { backendUrl, token, onExit: leaveScreen, onUnauthorized }));
    }

    if (screen === "config") {
        return fullScreen(h(ConfigScreen, { backendUrl, token, startAt: "tokens", onExit: leaveScreen, onUnauthorized }));
    }
    if (screen === "contacts") {
        return fullScreen(h(ContactsScreen, { backendUrl, token, onExit: leaveScreen, onUnauthorized }));
    }
    if (screen === "mcp") {
        return fullScreen(h(McpScreen, { backendUrl, token, onExit: leaveScreen, onUnauthorized }));
    }
    if (screen === "channels") {
        return fullScreen(h(ChannelsScreen, { localPort: config.localPort, backendUrl, token, onExit: leaveScreen, onUnauthorized }));
    }
    if (screen === "usage") {
        return fullScreen(h(UsageScreen, { backendUrl, token, onExit: leaveScreen, onUnauthorized }));
    }
    if (screen === "telemetry") {
        return fullScreen(h(TelemetryScreen, { backendUrl, token, onExit: leaveScreen, onUnauthorized }));
    }
    if (screen === "billing") {
        return fullScreen(h(BillingScreen, { backendUrl, token, onExit: leaveScreen, onUnauthorized }));
    }
    if (screen === "projects") {
        return fullScreen(h(ProjectsScreen, { backendUrl, token, onExit: leaveScreen, onUnauthorized, subscribeProgress }));
    }

    const alerts: string[] = [];
    if (clientState) {
        if (clientState.machineAgent.status === "disconnected" || clientState.machineAgent.status === "error") alerts.push("máquina offline");
        if (clientState.whatsapp.status === "error") alerts.push("WhatsApp desconectado");
        if (clientState.telegram.status === "error") alerts.push("Telegram com erro");
    }
    const statusInfo = { machine: machineName, branch, dir: shortPath(invocationCwd), sessionId, ...totals, alerts };

    let liveRegion: React.ReactElement;
    if (pending) liveRegion = h(PermissionDialog, { pending, onAnswer: handleConfirmation });
    else if (sending) liveRegion = h(StatusLine, { text: statusLine });
    else liveRegion = h(Composer, { value: inputValue, onChange: handleInputChange, onSubmit: handleSubmit, disabled: screen === "settings" || paletteOpen, resetKey: composerResetKey });

    const chat = h(
        Box,
        { flexDirection: "column", height: usableRows, width: mainColumns, backgroundColor: bg.base },
        // `flexGrow:1`: quando o histórico visível é mais curto que o
        // orçamento (`availableHistoryRows`), o Yoga estica esta caixa em
        // vez de deixar o composer grudado logo abaixo da última mensagem
        // — é isso que fixa a escrita na BASE da tela mesmo com pouco
        // conteúdo. Como as mensagens já vêm fatiadas pra caber (nunca
        // mais que `availableHistoryRows`), esticar aqui nunca estoura
        // `usableRows` no total.
        h(Box, { flexDirection: "column", flexGrow: 1 }, ...visibleHistory.map((item) => h(HistoryLine, { key: item.id, item }))),
        h(Text, { color: theme.textMuted }, exitHint ? "Pressione Ctrl+C de novo para sair" : scrollHintText(canScrollUp, canScrollDown)),
        h(ProjectProgressPanel, { projectSteps }),
        h(PlanPanel, { plan: activePlan }),
        error ? h(Text, { color: theme.danger }, `[erro] ${error}`) : null,
        liveRegion,
        showCommandMenu ? h(CommandMenu, { commands: filteredCommands, activeIndex: commandMenuIndex }) : null,
        showMentionMenu ? h(MentionMenu, { files: mentionMatches, activeIndex: mentionIndex, columns: mainColumns }) : null,
        h(StatusBar, { info: statusInfo, width: mainColumns }),
    );

    const base = sidebarVisible
        ? h(
              Box,
              { flexDirection: "row", height: usableRows },
              h(Sidebar, {
                  cwd: props.invocationCwd,
                  sessions: sidebarSessions,
                  activeSessionId: sessionId,
                  height: usableRows,
                  interactive: screen === "chat" && !paletteOpen,
                  onSelectSession: (session) => void resumeSession(session),
                  onNewSession: newSession,
                  onOpenAllSessions: () => setScreen("sessions"),
              }),
              chat,
          )
        : chat;
    if (paletteOpen) {
        return h(Box, { width: columns, height: usableRows }, base, h(CommandPaletteModal, { columns, usableRows, onRun: runFromPalette, onClose: () => setPaletteOpen(false) }));
    }
    if (screen !== "settings") return base;
    return h(
        Box,
        { width: columns, height: usableRows },
        base,
        h(SettingsModal, { backendUrl, token, columns, usableRows, sidebarOn: sidebarOpen, onSidebarChange: changeSidebar, onNavigate: openFromSettings, onClose: leaveScreen, onUnauthorized }),
    );
}
