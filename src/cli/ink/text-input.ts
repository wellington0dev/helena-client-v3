import React from "react";
import { Text, useInput } from "ink";
import chalk from "chalk";
import { c } from "./theme.ts";

/**
 * Fork de `ink-text-input` 6.0.0 (MIT, © Vadym Demedes) — o original só ignora Ctrl+C: qualquer outro atalho
 * (Ctrl+P da paleta, Ctrl+D, Alt+letra) caía no ramo "caractere digitado" e a letra VAZAVA pro campo. Corrigir por
 * fora não dá: o `onChange` dele não recebe a tecla, e a ordem dos handlers de `useInput` do Ink muda a cada
 * render. Mesma API/visual do original (cursor falso com `inverse`, placeholder cinza, `mask`); a lógica de tecla
 * foi extraída pra `applyKey` (pura, testável sem terminal). Placeholder em `c.muted` (token do tema) em vez do
 * cinza cru do chalk usado no original — regra do design system (theme.test.ts).
 */
export interface TextInputKey {
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    return?: boolean;
    backspace?: boolean;
    delete?: boolean;
    tab?: boolean;
    shift?: boolean;
    ctrl?: boolean;
    meta?: boolean;
}

export interface TextInputState {
    value: string;
    cursorOffset: number;
    /** Largura do último trecho inserido de uma vez (colagem) — só pro realce opcional de texto colado. */
    cursorWidth: number;
}

/** `"ignore"` = tecla não é deste campo; `"submit"` = Enter; senão o próximo estado. */
export function applyKey(state: TextInputState, input: string, key: TextInputKey, showCursor = true): TextInputState | "ignore" | "submit" {
    if (key.upArrow || key.downArrow || key.tab) return "ignore";
    if (key.return) return "submit";

    const { value, cursorOffset } = state;
    let nextValue = value;
    let nextCursor = cursorOffset;
    let nextWidth = 0;

    if (key.leftArrow) {
        if (showCursor) nextCursor--;
    } else if (key.rightArrow) {
        if (showCursor) nextCursor++;
    } else if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
            nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
            nextCursor--;
        }
    } else if (key.ctrl || key.meta) {
        // Atalho (Ctrl+P, Ctrl+D, Alt+letra…), nunca texto — quem trata é o handler da tela, não o campo.
        return "ignore";
    } else {
        nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
        nextCursor += input.length;
        if (input.length > 1) nextWidth = input.length;
    }

    return { value: nextValue, cursorOffset: Math.max(0, Math.min(nextValue.length, nextCursor)), cursorWidth: nextWidth };
}

export interface TextInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit?: (value: string) => void;
    placeholder?: string;
    focus?: boolean;
    mask?: string;
    highlightPastedText?: boolean;
    showCursor?: boolean;
}

export default function TextInput(props: TextInputProps): React.ReactElement {
    const { value: originalValue, onChange, onSubmit, placeholder = "", focus = true, mask, highlightPastedText = false, showCursor = true } = props;
    const [{ cursorOffset, cursorWidth }, setCursor] = React.useState({ cursorOffset: (originalValue || "").length, cursorWidth: 0 });

    React.useEffect(() => {
        setCursor((previous) => {
            if (!focus || !showCursor) return previous;
            const length = (originalValue || "").length;
            return previous.cursorOffset > length - 1 ? { cursorOffset: length, cursorWidth: 0 } : previous;
        });
    }, [originalValue, focus, showCursor]);

    useInput(
        (input, key) => {
            const next = applyKey({ value: originalValue, cursorOffset, cursorWidth }, input, key, showCursor);
            if (next === "ignore") return;
            if (next === "submit") {
                onSubmit?.(originalValue);
                return;
            }
            setCursor({ cursorOffset: next.cursorOffset, cursorWidth: next.cursorWidth });
            if (next.value !== originalValue) onChange(next.value);
        },
        { isActive: focus },
    );

    const cursorActualWidth = highlightPastedText ? cursorWidth : 0;
    const value = mask ? mask.repeat(originalValue.length) : originalValue;
    let renderedValue = value;
    let renderedPlaceholder = placeholder ? c.muted(placeholder) : undefined;
    // Cursor falso (inverse) — lidar com o cursor real do terminal entre escapes ANSI é bem mais chato.
    if (showCursor && focus) {
        renderedPlaceholder = placeholder.length > 0 ? chalk.inverse(placeholder[0]) + c.muted(placeholder.slice(1)) : chalk.inverse(" ");
        renderedValue = value.length > 0 ? "" : chalk.inverse(" ");
        let i = 0;
        for (const char of value) {
            renderedValue += i >= cursorOffset - cursorActualWidth && i <= cursorOffset ? chalk.inverse(char) : char;
            i++;
        }
        if (value.length > 0 && cursorOffset === value.length) renderedValue += chalk.inverse(" ");
    }

    return React.createElement(Text, null, placeholder && value.length === 0 ? renderedPlaceholder : renderedValue);
}
