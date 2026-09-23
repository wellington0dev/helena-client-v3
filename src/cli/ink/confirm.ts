import React from "react";
import { Box, Text, useInput } from "ink";
import { panel, SPACE, theme } from "./theme.ts";

const h = React.createElement;

export interface ConfirmProps {
    /** Texto da pergunta — pode ter múltiplas linhas (`\n`), ex: nome do item apagado numa linha própria. */
    message: string;
    /** A ação já está rodando (ex: apagar de verdade, depois do "s") — ignora s/n/Esc e troca o rodapé por "aplicando...". */
    busy?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Confirmação textual (s/n) antes de uma ação irreversível — mesmo painel `panel("warning")` que EXISTIA
 * ESPALHADO em 4 lugares antes desta extração (`crud-screen.ts`, `sessions-screen.ts`, `channels-screen.ts`,
 * `project-detail-screen.ts` — 2026-09-22/23): mesmo texto de rodapé, mesmas teclas, só o `message` (e, num deles,
 * o `busy`) mudava. `project-detail-screen.ts` era o único que também não tratava Esc (só "s"/"n") — inconsistência
 * real corrigida ao migrar pra cá, não comportamento novo escondido. Quem monta isto DEVE parar de tratar
 * `s`/`n`/Esc no próprio `useInput` enquanto confirma (early-return), senão as duas leituras de teclado disputam a
 * MESMA tecla (`useInput` do Ink entrega pra TODO hook ativo — ver mesmo cuidado em app.ts#Ctrl+P).
 */
export function Confirm(props: ConfirmProps): React.ReactElement {
    const { message, busy = false, onConfirm, onCancel } = props;

    useInput((input, key) => {
        if (busy) return;
        const normalized = input.trim().toLowerCase();
        if (normalized === "s") onConfirm();
        else if (normalized === "n" || key.escape) onCancel();
    });

    return h(
        Box,
        { flexDirection: "column", ...panel("warning") },
        h(Text, { bold: true, color: theme.warning }, message),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, null, busy ? "aplicando..." : "Confirmar? (s/n)"),
    );
}
