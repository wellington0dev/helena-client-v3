import React from "react";
import { Box, Text, useInput } from "ink";
import { panel, SPACE, theme } from "./theme.ts";

const h = React.createElement;

export interface ConfirmProps {
    /** Texto da pergunta — pode ter múltiplas linhas (`\n`), ex: nome do item apagado numa linha própria. */
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Confirmação textual (s/n) antes de uma ação irreversível — mesmo painel `panel("warning")` nas duas
 * implementações que existiam ANTES desta extração (`crud-screen.ts`, pro "apagar 1 item", e `sessions-screen.ts`,
 * reinventado do zero só pro "limpar tudo" — 2026-09-22): mesmo texto de rodapé, mesmas teclas, só o `message`
 * mudava. Quem monta isto DEVE parar de tratar `s`/`n`/Esc no próprio `useInput` enquanto confirma (early-return),
 * senão as duas leituras de teclado disputam a MESMA tecla (`useInput` do Ink entrega pra TODO hook ativo — ver
 * mesmo cuidado em app.ts#Ctrl+P).
 */
export function Confirm(props: ConfirmProps): React.ReactElement {
    const { message, onConfirm, onCancel } = props;

    useInput((input, key) => {
        const normalized = input.trim().toLowerCase();
        if (normalized === "s") onConfirm();
        else if (normalized === "n" || key.escape) onCancel();
    });

    return h(
        Box,
        { flexDirection: "column", ...panel("warning") },
        h(Text, { bold: true, color: theme.warning }, message),
        h(Box, { marginTop: SPACE.tight }),
        h(Text, null, "Confirmar? (s/n)"),
    );
}
