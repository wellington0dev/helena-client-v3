import React from "react";
import { Box, Text } from "ink";
import { c, theme } from "../theme.ts";

interface RightPanelProps {
  activeTab: "toolCalls" | "plan" | "project";
  setActiveTab: (tab: "toolCalls" | "plan" | "project") => void;
  toolCalls: ToolCallInfo[];
  plan: AgentPlan | null;
  project: ProjectInfo | null;
  width: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed";
  startTime: string;
  duration?: number;
}

export interface AgentPlan {
  id: string;
  title: string;
  description: string;
  status: "active" | "completed" | "archived";
  steps: PlanStep[];
  updatedAt: string;
}

export interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  status: "draft" | "planning" | "active" | "paused" | "completed" | "cancelled";
  machine: string;
  steps: ProjectStepInfo[];
  costCap?: number;
  gitPushAllowed: boolean;
}

export interface ProjectStepInfo {
  id: string;
  role: string;
  focus: string;
  status: "ready" | "running" | "done" | "failed";
  instruction: string;
}

const h = React.createElement;

export function RightPanel(props: RightPanelProps): React.ReactElement {
  const { activeTab, setActiveTab, toolCalls, plan, project, width } = props;

  const tabs = [
    { id: "toolCalls", label: "⚡ Tool Calls", count: toolCalls.length },
    { id: "plan", label: "📋 Plan", count: plan?.steps.length ?? 0 },
    { id: "project", label: "📦 Project", count: project?.steps.length ?? 0 },
  ];

  function renderToolCalls(): React.ReactElement[] {
    return toolCalls.map((call) => {
      const statusIcon =
        call.status === "pending" ? "⏳" :
        call.status === "running" ? "▶" :
        call.status === "completed" ? "✓" :
        "✗";
      const statusColor =
        call.status === "pending" ? theme.textMuted :
        call.status === "running" ? theme.primary :
        call.status === "completed" ? theme.success :
        theme.danger;

      return h(
        Box,
        { key: call.id, flexDirection: "column", marginBottom: 1, borderStyle: "single", borderColor: theme.border, padding: 1 },
        h(Box, { flexDirection: "row", gap: 1, marginBottom: 1 },
          h(Text, { color: statusColor, bold: true }, statusIcon),
          h(Text, { color: theme.primary, bold: true }, call.name),
          h(Text, { color: theme.textMuted, dimColor: true }, call.startTime),
        ),
        h(Box, { marginLeft: 2 },
          h(Text, { color: theme.accent, bold: true }, "Input:"),
          h(Text, { color: theme.textMuted, dimColor: true, wrap: true }, JSON.stringify(call.input, null, 2).slice(0, 500)),
        ),
        call.output && h(Box, { marginTop: 1, marginLeft: 2 },
          h(Text, { color: theme.accent, bold: true }, "Output:"),
          h(Text, { color: theme.textMuted, dimColor: true, wrap: true }, JSON.stringify(call.output, null, 2).slice(0, 500)),
        ),
      );
    });
  }

  function renderPlan(): React.ReactElement | null {
    if (!plan) return null;

    const statusColor =
      plan.status === "active" ? theme.primary :
      plan.status === "completed" ? theme.success :
      theme.textMuted;
    const statusLabel =
      plan.status === "active" ? "● ATIVO" :
      plan.status === "completed" ? "✓ CONCLUÍDO" :
      "⊘ ARQUIVADO";

    return h(
      Box,
      { flexDirection: "column" },
      h(Box, { gap: 1, marginBottom: 1 },
        h(Text, { color: theme.accent, bold: true }, `Plano: ${plan.title}`),
        h(Text, { color: statusColor, bold: true }, statusLabel),
      ),
      h(Text, { dimColor: true, marginBottom: 1 }, plan.description),
      h(Text, { color: theme.textMuted, marginBottom: 1 }, `Atualizado: ${plan.updatedAt}`),
      h(Text, null, " "),
      ...plan.steps.map((step, i) => {
        const stepIcon =
          step.status === "completed" ? "✓" :
          step.status === "in_progress" ? "▶" :
          step.status === "failed" ? "✗" :
          step.status === "cancelled" ? "⊘" :
          "○";
        const stepColor =
          step.status === "completed" ? theme.success :
          step.status === "in_progress" ? theme.primary :
          step.status === "failed" ? theme.danger :
          step.status === "cancelled" ? theme.warning :
          theme.textMuted;
        const indent = "  ";
        return h(
          Box,
          { key: step.id, flexDirection: "column", marginBottom: i === plan.steps.length - 1 ? 0 : 1 },
          h(Text, { color: stepColor }, `${indent}${stepIcon} ${step.title}`),
          step.description && h(Text, { dimColor: true, marginLeft: 4 }, `${indent}  ${step.description}`),
          step.error && h(Text, { color: theme.danger, marginLeft: 4 }, `${indent}  Erro: ${step.error}`),
        );
      }),
    );
  }

  function renderProject(): React.ReactElement | null {
    if (!project) return null;

    const statusColor =
      project.status === "active" ? theme.primary :
      project.status === "completed" ? theme.success :
      project.status === "paused" ? theme.warning :
      project.status === "failed" ? theme.danger :
      theme.textMuted;

    return h(
      Box,
      { flexDirection: "column" },
      h(Box, { gap: 1, marginBottom: 1 },
        h(Text, { color: theme.accent, bold: true }, `Projeto: ${project.name}`),
        h(Text, { color: statusColor, bold: true }, project.status.toUpperCase()),
      ),
      h(Box, { marginLeft: 2, marginBottom: 1 },
        h(Text, { color: theme.accent }, "Máquina: "),
        h(Text, { color: theme.text }, project.machine),
      ),
      project.costCap && h(Box, { marginLeft: 2, marginBottom: 1 },
        h(Text, { color: theme.accent }, "Limite de custo: "),
        h(Text, { color: theme.text }, `${project.costCap} tokens`),
      ),
      h(Box, { marginLeft: 2, marginBottom: 1 },
        h(Text, { color: theme.accent }, "Git push: "),
        h(Text, { color: project.gitPushAllowed ? theme.success : theme.danger }, project.gitPushAllowed ? "Permitido" : "Bloqueado"),
      ),
      h(Text, { color: theme.accent, bold: true, marginTop: 1, marginBottom: 1 }, "Steps:"),
      ...project.steps.map((step, i) => {
        const stepStatusColor =
          step.status === "done" ? theme.success :
          step.status === "running" ? theme.primary :
          step.status === "failed" ? theme.danger :
          theme.textMuted;
        const stepIcon =
          step.status === "done" ? "✓" :
          step.status === "running" ? "▶" :
          step.status === "failed" ? "✗" :
          "○";
        return h(
          Box,
          { key: step.id, flexDirection: "column", marginLeft: 2, marginBottom: i === project.steps.length - 1 ? 0 : 1 },
          h(Box, { flexDirection: "row", gap: 1 },
            h(Text, { color: stepStatusColor }, stepIcon),
            h(Text, { color: theme.primary, bold: true }, step.role),
            h(Text, { color: theme.textMuted, dimColor: true }, step.focus),
          ),
          h(Text, { color: theme.textMuted, dimColor: true, marginLeft: 4 }, step.instruction.slice(0, 100)),
        );
      }),
    );
  }

  return h(
    Box,
    { flexDirection: "column", width: width, borderStyle: "single", borderColor: theme.border, flexShrink: 0 },
    h(
      Box,
      { flexDirection: "row", borderStyle: "single", borderColor: theme.border, paddingX: 1 },
      ...tabs.map((tab) =>
        h(
          Box,
          {
            key: tab.id,
            flexGrow: 1,
            paddingY: 1,
            backgroundColor: activeTab === tab.id ? theme.primary : "transparent",
            onClick: () => setActiveTab(tab.id as any),
          },
          h(Text, { color: activeTab === tab.id ? theme.background : theme.text, bold: true, align: "center" }, `${tab.label} ${tab.count > 0 ? `(${tab.count})` : ""}`),
        ),
      ),
    ),
    h(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, paddingY: 1, overflowY: "auto" },
      activeTab === "toolCalls" && h(Box, { flexDirection: "column" }, ...renderToolCalls()),
      activeTab === "plan" && renderPlan(),
      activeTab === "project" && renderProject(),
    ),
  );
}