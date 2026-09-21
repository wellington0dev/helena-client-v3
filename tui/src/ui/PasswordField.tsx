import { useKeyboard } from "@opentui/react";
import { theme } from "./theme.ts";

/**
 * Campo de senha: o `<input>` do OpenTUI não tem máscara, então este componente captura as teclas e mostra `•`.
 * O valor real nunca vai pra tela. Enter envia; Backspace apaga; Ctrl+U limpa.
 */
export function PasswordField(props: { value: string; onChange: (update: (previous: string) => string) => void; onSubmit: () => void; focused: boolean; placeholder?: string }) {
    useKeyboard((key) => {
        if (!props.focused) return;
        if (key.name === "return" || key.name === "enter") return props.onSubmit();
        // atualizações FUNCIONAIS: teclas rápidas (ou colar) chegam antes do próximo render — usar `props.value` aqui perderia caracteres
        if (key.name === "backspace") return props.onChange((v) => v.slice(0, -1));
        if (key.ctrl && key.name === "u") return props.onChange(() => "");
        if (key.ctrl || key.meta) return;
        const seq = key.sequence ?? "";
        if (seq.length === 1 && seq >= " " && seq !== "\x7f") props.onChange((v) => v + seq);
    });
    const shown = props.value.length > 0 ? "•".repeat(props.value.length) : (props.placeholder ?? "");
    return <text fg={props.value.length > 0 ? theme.text : theme.muted}>{shown + (props.focused ? "▏" : "")}</text>;
}
