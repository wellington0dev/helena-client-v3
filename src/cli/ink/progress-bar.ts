import React from "react";
import { Text } from "ink";
import { theme } from "./theme.ts";

const h = React.createElement;

/**
 * Barra `[████░░░░]` — pura, sem Ink, pra testar sem montar componente (mesmo padrão de `project-progress.ts`).
 * `total<=0` devolve a barra toda vazia (evita `NaN`/divisão por zero) — nunca lança.
 */
export function renderBar(done: number, total: number, width = 10): string {
    if (total <= 0) return "░".repeat(width);
    const filled = Math.min(width, Math.round((Math.max(0, done) / total) * width));
    return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * Progresso genérico (`done`/`total`) — nenhuma tela usa isto ainda (2026-09-23): os dois lugares com "progresso"
 * hoje (`ProjectProgressPanel`/`PlanPanel` em app.ts) são CHECKLIST por step (ícone por status), não fração
 * numérica, e cada um já tem sua função de medição de linhas própria pareada no viewport — plugar uma barra ali
 * exigiria atualizar essa medição junto, então deixei fora desta rodada pra não arriscar a conta de altura do chat
 * fullscreen (ver viewport.ts) por um ganho só cosmético. Fica pronto pra quando algo precisar de fração mesmo
 * (ex: barra de custo gasto/teto de um Project).
 */
export function ProgressBar(props: { done: number; total: number; width?: number }): React.ReactElement {
    const { done, total, width = 10 } = props;
    return h(Text, { color: theme.primary }, renderBar(done, total, width));
}
