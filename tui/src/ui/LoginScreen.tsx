import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { LocalApiError, type LocalApi } from "../api/client.ts";
import { PasswordField } from "./PasswordField.tsx";
import { theme } from "./theme.ts";

/** Login/cadastro pelo daemon (`/v1/session/login`): a TUI nunca vê o JWT, só recebe `{user}`. */
export function LoginScreen(props: { api: LocalApi; expired?: boolean; onLoggedIn: (user: { email: string }) => void }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [field, setField] = useState<"email" | "password">("email");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | undefined>();

    async function submit() {
        if (busy) return;
        if (!email.trim() || !password) {
            setError("Informe e-mail e senha.");
            return;
        }
        setBusy(true);
        setError(undefined);
        try {
            const { user } = await props.api.login(email.trim(), password);
            setPassword("");
            props.onLoggedIn(user);
        } catch (e) {
            setError(e instanceof LocalApiError ? e.message : String(e));
            setPassword("");
        } finally {
            setBusy(false);
        }
    }

    useKeyboard((key) => {
        if (key.name === "tab") setField((f) => (f === "email" ? "password" : "email"));
    });

    return (
        <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
            <box flexDirection="column" width={60} border borderStyle="rounded" title=" Helena — entrar " padding={1} gap={1}>
                {props.expired ? <text fg={theme.warn}>Sua sessão expirou. Entre de novo (a conversa continua aqui).</text> : <text fg={theme.muted}>Entre com a conta da Helena.</text>}
                <box border title=" e-mail " height={3}>
                    <input placeholder="voce@exemplo.com" focused={field === "email" && !busy} value={email} onInput={setEmail} onSubmit={(() => setField("password")) as never} />
                </box>
                <box border title=" senha " height={3}>
                    <PasswordField value={password} onChange={setPassword} onSubmit={submit} focused={field === "password" && !busy} placeholder="sua senha" />
                </box>
                {error ? <text fg={theme.error}>{error}</text> : busy ? <text fg={theme.muted}>entrando…</text> : <text fg={theme.muted}>Enter avança/envia · Tab troca de campo · Ctrl+C sai</text>}
            </box>
        </box>
    );
}
