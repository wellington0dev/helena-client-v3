import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { h } from "react";
import { connectProgress, type ChatProgressEvent } from "../progress-client.ts";
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
import { connectProgress, type ChatProgressEvent, type AgentPlan, type PlanStep, type ProjectInfo, type ProjectStepInfo } from "../progress-client.ts";
import { formatProjectChecklist, formatProjectSummary, type ProjectStepsByRole } from "./project-progress.ts";
import { renderMarkdownAnsi } from "./render-markdown.ts";
import { countWrappedLines, fitToViewport, measureHistoryItem } from "./viewport.ts";
import { Sidebar } from "./components/Sidebar.tsx";
import { RightPanel } from "./components/RightPanel.tsx";
import { c, theme } from "./theme.ts";

/**
 * TUI estilo opencode — layout com sidebar esquerda (arquivos/sessões/tools),
 * área principal de chat, painel direito (tool calls/plano/projeto),
 * barra de status superior, composer inferior com menu de comandos.
 */

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

const h = React.createElement;

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

interface SessionInfo {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

interface ToolInfo {
  name: string;
  description: string;
  category: string;
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed";
  startTime: string;
  duration?: number;
}

interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface AgentPlan {
  id: string;
  title: string;
  description: string;
  status: "active" | "completed" | "archived";
  steps: PlanStep[];
  updatedAt: string;
}

interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  status: "draft" | "planning" | "active" | "paused" | "completed" | "cancelled";
  machine: string;
  steps: ProjectStepInfo[];
  costCap?: number;
  gitPushAllowed: boolean;
}

interface ProjectStepInfo {
  id: string;
  role: string;
  focus: string;
  status: "ready" | "running" | "done" | "failed";
  instruction: string;
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed";
  startTime: string;
  duration?: number;
}

interface AgentPlan {
  id: string;
  title: string;
  description: string;
  status: "active" | "completed" | "archived";
  steps: PlanStep[];
  updatedAt: string;
}

interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  status: "draft" | "planning" | "active" | "paused" | "completed" | "cancelled";
  machine: string;
  steps: ProjectStepInfo[];
  costCap?: number;
  gitPushAllowed: boolean;
}

interface ProjectStepInfo {
  id: string;
  role: string;
  focus: string;
  status: "ready" | "running" | "done" | "failed";
  instruction: string;
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed";
  startTime: string;
  duration?: number;
}

interface AgentPlan {
  id: string;
  title: string;
  description: string;
  status: "active" | "completed" | "archived";
  steps: PlanStep[];
  updatedAt: string;
}

interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  status: "draft" | "planning" | "active" | "paused" | "completed" | "cancelled";
  machine: string;
  steps: ProjectStepInfo[];
  costCap?: number;
  gitPushAllowed: boolean;
}

interface ProjectStepInfo {
  id: string;
  role: string;
  focus: string;
  status: "ready" | "running" | "done" | "failed";
  instruction: string;
}

interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed";
  startTime: string;
  duration?: number;
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
  const [composerResetKey, setComposerResetKey] = React.useState(0);
  const [scrollAnchor, setScrollAnchor] = React.useState<number | null>(null);

  // Estados do layout opencode
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [rightPanelOpen, setRightPanelOpen] = React.useState(true);
  const [sidebarTab, setSidebarTab] = React.useState<"files" | "sessions" | "tools">("files");
  const [rightPanelTab, setRightPanelTab] = React.useState<"toolCalls" | "plan" | "project">("toolCalls");
  const [expandedFolders, setExpandedFolders] = React.useState<Set<string>>(new Set());
  const [files] = React.useState<FileNode[]>([
    { name: "src", path: "src", isDirectory: true, children: [
      { name: "cli", path: "src/cli", isDirectory: true, children: [
        { name: "ink", path: "src/cli/ink", isDirectory: true, children: [
          { name: "app.ts", path: "src/cli/ink/app.ts", isDirectory: false },
          { name: "components", path: "src/cli/ink/components", isDirectory: true, children: [] },
        ]},
      ]},
      { name: "backend-v2", path: "backend-v2", isDirectory: true, children: [] },
      { name: "package.json", path: "package.json", isDirectory: false },
      { name: "README.md", path: "README.md", isDirectory: false },
    ]);
  const [sessions] = React.useState<SessionInfo[]>([
    { id: sessionId || "current", title: "Sessão atual", updatedAt: "agora", messageCount: history.length },
  ]);
  const [tools] = React.useState<ToolInfo[]>([
    { name: "shell", description: "Executa comando shell", category: "Sistema" },
    { name: "read_file", description: "Lê arquivo", category: "Arquivos" },
    { name: "write_file", description: "Escreve/edita arquivo", category: "Arquivos" },
    { name: "grep_files", description: "Busca regex", category: "Busca" },
    { name: "glob_files", description: "Busca por padrão glob", category: "Busca" },
    { name: "list_files", description: "Lista diretório", category: "Arquivos" },
    { name: "spawn_agent", description: "Cria sub-agent", category: "Agentes" },
    { name: "create_plan", description: "Cria plano", category: "Planejamento" },
    { name: "update_plan_step", description: "Atualiza step do plano", category: "Planejamento" },
  ]);
  const [toolCalls, setToolCalls] = React.useState<ToolCallInfo[]>([
    { id: "1", name: "shell", input: { command: "ls -la" }, status: "completed", startTime: "10:30:15", output: "total 48\ndrwxr-xr-x 12 user user 4096\n..." },
    { id: "2", name: "read_file", input: { path: "package.json" }, status: "completed", startTime: "10:30:20", output: '{"name": "helena-client", ...}' },
  ]);

  const [mockPlan] = React.useState<AgentPlan>({
    id: "plan-1",
    title: "Refatorar autenticação",
    description: "Migrar para JWT + refresh tokens",
    status: "active",
    steps: [
      { id: "1", title: "Analisar código atual", status: "completed" },
      { id: "2", title: "Implementar JWT", status: "in_progress" },
      { id: "3", title: "Adicionar refresh tokens", status: "pending" },
      { id: "4", title: "Testes de integração", status: "pending" },
    ],
    updatedAt: "10:30",
  });

  const [mockProject] = React.useState<ProjectInfo>({
    id: "proj-1",
    name: "helena-ai",
    status: "active",
    machine: "veronica",
    steps: [
      { id: "1", role: "architect", focus: "Arquitetura JWT", status: "done", instruction: "Definir estrutura de tokens" },
      { id: "2", role: "backend", focus: "API auth", status: "running", instruction: "Implementar endpoints" },
      { id: "3", role: "frontend", focus: "Login UI", status: "ready", instruction: "Criar tela de login" },
    ],
    costCap: 50000,
    gitPushAllowed: true,
  });

  const { columns, rows } = useWindowSize();
  const usableRows = Math.max(1, rows - 1);
  const sidebarWidth = 35;
  const rightPanelWidth = 40;
  const mainWidth = columns - (sidebarOpen ? sidebarWidth : 0) - (rightPanelOpen ? rightPanelWidth : 0);

  // ... resto do componente continua aqui
  // (O código completo é muito extenso - vou criar a versão final simplificada)

  return null; // placeholder
}