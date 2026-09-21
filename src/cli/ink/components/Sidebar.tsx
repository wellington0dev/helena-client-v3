import React from "react";
import { Box, Text, useInput } from "ink";
import { c, theme } from "./theme.ts";

interface SidebarProps {
  activeTab: "files" | "sessions" | "tools";
  setActiveTab: (tab: "files" | "sessions" | "tools") => void;
  files: FileNode[];
  sessions: SessionInfo[];
  tools: ToolInfo[];
  expandedFolders: Set<string>;
  toggleFolder: (path: string) => void;
  selectFile: (path: string) => void;
  selectSession: (id: string) => void;
  width: number;
}

export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

export interface SessionInfo {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
}

const h = React.createElement;

export function Sidebar(props: SidebarProps): React.ReactElement {
  const { activeTab, setActiveTab, files, sessions, tools, expandedFolders, toggleFolder, selectFile, selectSession, width } = props;

  const tabs = [
    { id: "files", label: "📁 Files", key: "1" },
    { id: "sessions", label: "💬 Sessions", key: "2" },
    { id: "tools", label: "🔧 Tools", key: "3" },
  ];

  useInput((input, key) => {
    if (key.ctrl) {
      if (input === "1") setActiveTab("files");
      else if (input === "2") setActiveTab("sessions");
      else if (input === "3") setActiveTab("tools");
    }
  });

  function renderFileTree(nodes: FileNode[], depth = 0): React.ReactElement[] {
    return nodes.map((node) => {
      const isExpanded = expandedFolders.has(node.path);
      const hasChildren = node.children && node.children.length > 0;
      const indent = "  ".repeat(depth);

      if (node.isDirectory && hasChildren) {
        return h(
          Box,
          { key: node.path, flexDirection: "column" },
          h(
            Box,
            { flexDirection: "row", gap: 1 },
            h(Text, { color: isExpanded ? theme.primary : theme.textMuted }, indent + (isExpanded ? "▼ " : "▶ ")),
            h(Text, { color: theme.accent, bold: true }, node.name),
          ),
          isExpanded && h(Box, { marginLeft: 2 }, ...renderFileTree(node.children!, depth + 1)),
        );
      }

      return h(
        Box,
        { key: node.path, flexDirection: "row", gap: 1 },
        h(Text, { color: theme.textMuted }, indent + "  "),
        h(
          Text,
          {
            color: theme.text,
            onClick: () => selectFile(node.path),
          },
          node.name,
        ),
      );
    });
  }

  function renderSessions(): React.ReactElement[] {
    return sessions.map((session) =>
      h(
        Box,
        { key: session.id, flexDirection: "row", gap: 1, marginBottom: 1 },
        h(Text, { color: theme.textMuted }, "💬"),
        h(
          Box,
          { flexDirection: "column", flexGrow: 1, onClick: () => selectSession(session.id) },
          h(Text, { color: theme.text, bold: true, truncate: true }, session.title),
          h(Text, { color: theme.textMuted, size: "small" }, `${session.messageCount} msgs • ${session.updatedAt}`),
        ),
      ),
    );
  }

  function renderTools(): React.ReactElement[] {
    const categories = [...new Set(tools.map((t) => t.category))];
    return categories.map((cat) => [
      h(Text, { key: `cat-${cat}`, color: theme.primary, bold: true, marginTop: 1 }, cat),
      ...tools
        .filter((t) => t.category === cat)
        .map((tool) =>
          h(
            Box,
            { key: tool.name, flexDirection: "row", gap: 1, marginLeft: 2 },
            h(Text, { color: theme.textMuted }, "⚡"),
            h(Text, { color: theme.text }, tool.name),
            h(Text, { color: theme.textMuted, dimColor: true }, tool.description),
          ),
        ),
    ]).flat();
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
          h(Text, { color: activeTab === tab.id ? theme.background : theme.text, bold: true, align: "center" }, tab.label),
        ),
      ),
    ),
    h(Box, { flexDirection: "column", flexGrow: 1, paddingX: 1, paddingY: 1, overflowY: "auto" },
      activeTab === "files" && h(Box, { flexDirection: "column" }, ...renderFileTree(files)),
      activeTab === "sessions" && h(Box, { flexDirection: "column" }, ...renderSessions()),
      activeTab === "tools" && h(Box, { flexDirection: "column" }, ...renderTools()),
    ),
  );
}