import React from "react";
import { useInput } from "ink";

/**
 * Mouse no terminal (protocolo SGR, `?1006`). O Ink não trata mouse: entrega a sequência inteira como TEXTO em
 * `useInput` (`"[<0;10;5M"`, ESC já removido, sem flags de tecla). Por isso o mouse é lido AQUI, dentro do `useInput`,
 * e só enquanto um componente que o usa está montado — o tempo todo ligado (a) digitaria a sequência no campo de texto
 * e (b) faria o terminal desligar a seleção/cópia nativa de texto, que é essencial num chat.
 *
 * Coordenadas: o terminal reporta 1-based; `parseMouse` já converte pra 0-based, o mesmo sistema do layout do Ink
 * (o app roda em tela alternativa, canto superior esquerdo = (0,0)).
 */

export type MouseEventType = "press" | "release" | "move" | "wheelUp" | "wheelDown";
export type MouseButton = "left" | "middle" | "right" | "none";

export interface MouseEvent {
    type: MouseEventType;
    button: MouseButton;
    /** Coluna e linha 0-based (layout do Ink). */
    x: number;
    y: number;
    shift: boolean;
    alt: boolean;
    ctrl: boolean;
}

/** Liga: `?1003` (qualquer movimento — hover) + `?1006` (coordenadas SGR, sem limite de 223 colunas). */
export const MOUSE_ON = "\x1b[?1003h\x1b[?1006h";
export const MOUSE_OFF = "\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l";

// O Ink remove o ESC, então a sequência chega como "[<b;x;yM"; aceita também com ESC (streams que não passam pelo Ink).
const SGR = /\x1b?\[<(\d+);(\d+);(\d+)([Mm])/g;

/** Extrai TODOS os eventos de mouse de um `input` (rajadas podem juntar vários) e devolve o resto (texto que não é mouse). */
export function parseMouse(input: string): { events: MouseEvent[]; rest: string } {
    const events: MouseEvent[] = [];
    const rest = input.replace(SGR, (_match, rawCode: string, rawX: string, rawY: string, final: string) => {
        const code = Number(rawCode);
        const x = Number(rawX) - 1;
        const y = Number(rawY) - 1;
        const flags = { shift: (code & 4) !== 0, alt: (code & 8) !== 0, ctrl: (code & 16) !== 0 };
        if ((code & 64) !== 0) {
            events.push({ type: (code & 1) === 0 ? "wheelUp" : "wheelDown", button: "none", x, y, ...flags });
        } else {
            const motion = (code & 32) !== 0;
            const button: MouseButton = motion && (code & 3) === 3 ? "none" : (["left", "middle", "right", "none"] as const)[code & 3]!;
            events.push({ type: motion ? "move" : final === "m" ? "release" : "press", button, x, y, ...flags });
        }
        return "";
    });
    return { events, rest };
}

export function looksLikeMouse(input: string): boolean {
    SGR.lastIndex = 0;
    return SGR.test(input);
}

/**
 * Recebe eventos de mouse enquanto `active`. Liga o rastreamento ao ficar ativo e SEMPRE desliga na saída/desmontagem.
 * Quem também usa `useInput` deve ignorar entradas onde `looksLikeMouse(input)` é verdadeiro.
 */
export function useMouse(handler: (event: MouseEvent) => void, active: boolean): void {
    const handlerRef = React.useRef(handler);
    handlerRef.current = handler;

    React.useEffect(() => {
        if (!active) return;
        process.stdout.write(MOUSE_ON);
        return () => {
            process.stdout.write(MOUSE_OFF);
        };
    }, [active]);

    useInput(
        (input) => {
            const { events } = parseMouse(input);
            for (const event of events) handlerRef.current(event);
        },
        { isActive: active },
    );
}
