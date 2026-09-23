import React from "react";
import { Box, Text } from "ink";
import { panel, theme } from "./theme.ts";

const h = React.createElement;

/**
 * Erro fatal de carregamento que TOMA a tela inteira — mesmo bloco (`panel("danger")` + "Erro: ..." + dica de como
 * sair) que 4 telas já tinham copiado IDÊNTICO (`config-screen.ts`/`contacts-screen.ts`/`projects-screen.ts`/
 * `project-detail-screen.ts`) e outras 3 desenhavam parecido, mas sem o painel (`mcp-screen.ts`/`usage-screen.ts`/
 * mais um estado de `projects-screen.ts`) — 2026-09-23. NÃO é pra erro CONTEXTUAL que aparece ao lado de outro
 * conteúdo (ex: erro de validação de um formulário ainda visível) — aí o `Text` cru continua certo, isto é só pro
 * caso "a tela inteira virou uma mensagem de erro".
 */
export function ErrorPanel(props: { error: string; hint?: string }): React.ReactElement {
    const { error, hint = "Esc pra voltar ao chat" } = props;
    return h(Box, { flexDirection: "column", ...panel("danger") }, h(Text, { color: theme.danger }, `Erro: ${error}`), h(Text, { color: theme.textMuted }, hint));
}
