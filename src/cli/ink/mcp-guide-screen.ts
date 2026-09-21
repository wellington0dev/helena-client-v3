import React from "react";
import { Box, Text, useInput } from "ink";
import { buildMcpGuideMarkdown } from "./mcp-guide-content.ts";
import { renderMarkdownAnsi } from "./render-markdown.ts";
import { theme, panel } from "./theme.ts";

const h = React.createElement;

/** Guia estático (read-only) de como montar um servidor MCP compatível — mesmo conteúdo do painel, sem sanitização HTML (aqui é só texto no terminal). */
export function McpGuideScreen(props: { backendUrl: string; token: string; onExit: () => void }): React.ReactElement {
    const { backendUrl, token, onExit } = props;

    useInput((_input, key) => {
        if (key.escape) onExit();
    });

    const markdown = buildMcpGuideMarkdown(backendUrl, token);
    const lines = renderMarkdownAnsi(markdown).split("\n");

    return h(
        Box,
        { flexDirection: "column", ...panel("border") },
        h(Text, { bold: true, color: theme.primary }, "Guia — como montar um servidor MCP compatível"),
        h(Box, { marginTop: 1 }),
        h(Box, { flexDirection: "column" }, ...lines.map((line, i) => h(Text, { key: i }, line || " "))),
        h(Box, { marginTop: 1 }),
        h(Text, { color: theme.textMuted }, "Esc volta"),
    );
}
