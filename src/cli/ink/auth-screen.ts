import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { login, register, type AuthOutcome } from "../backend.ts";
import { Form } from "./form.ts";
import { bg, theme, SPACE } from "./theme.ts";

const h = React.createElement;

export type AuthScreenOutcome = ({ type: "success" } & AuthOutcome) | { type: "exit" };

type Mode = "login" | "signup";

/**
 * Entrada do `helena` — login OU cadastro, mesmo `Form` usado no resto do app (2026-09-23, pedido do dono: "criar
 * uma página de cadastro e de login pra tui"). Substitui o prompt de `readline` puro que existia antes em chat.ts —
 * elimina de vez a categoria de bug documentada ali ("readline trava stdin antes do Ink"): não existe mais
 * NENHUMA transição readline→Ink, o login já é Ink desde o início.
 *
 * Ctrl+R alterna pra cadastro, Ctrl+L volta pro login.
 *
 * Fala DIRETO com o backend (`/auth/login`/`/auth/register`), nunca com o daemon local (`/v1/auth/*` em
 * local-api/session-manager.ts) — apesar do comentário lá dizer "a TUI nunca vê o token", isso é arquitetura órfã
 * de um client `tui/` que existiu e foi removido; nada no `cli/`/`ink/` atual chama essas rotas do daemon hoje. O
 * `helena` precisa funcionar mesmo numa máquina sem o daemon (`helena-client.service`) rodando — é assim que o
 * resto de `chat.ts` (`notifyLocalDaemon`, best-effort) já trata o daemon: opcional, nunca exigido.
 */
export function AuthScreen(props: { backendUrl: string; onDone: (outcome: AuthScreenOutcome) => void }): React.ReactElement {
    const { backendUrl, onDone } = props;
    // Mesma conta de `usableRows` do App (ver app.ts) — escrever na última célula da última linha faz vários
    // terminais rolarem uma linha sozinhos (auto-margin), brigando com o apaga-e-redesenha do Ink.
    const { columns, rows } = useWindowSize();
    const usableRows = Math.max(1, rows - 1);
    const [mode, setMode] = React.useState<Mode>("login");
    // Ctrl+R/Ctrl+L não vazam mais a letra pro campo com foco (ver text-input.ts) — o Form só remonta (`key: mode`)
    // quando o modo muda de verdade, então apertar Ctrl+R já no cadastro não apaga o que foi digitado.
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);

    // `exitOnCtrlC: false` no `render()` de quem monta esta tela (ver chat.ts#runAuthScreen) — Ctrl+C/Ctrl+D só
    // funcionam porque este componente os trata, mesmo padrão de app.ts (o Ink não sai sozinho por baixo).
    useInput((input, key) => {
        if (key.ctrl && (input === "c" || input === "d")) {
            onDone({ type: "exit" });
            return;
        }
        if (busy) return;
        if (key.ctrl && input === "r") {
            setMode("signup");
            setError(undefined);
        } else if (key.ctrl && input === "l") {
            setMode("login");
            setError(undefined);
        }
    });

    async function handleSubmit(values: Record<string, string>): Promise<void> {
        const email = values.email?.trim() ?? "";
        const password = values.password ?? "";
        if (!email || !password) {
            setError("Email e senha são obrigatórios.");
            return;
        }
        setBusy(true);
        setError(undefined);
        try {
            const outcome = mode === "login" ? await login(backendUrl, email, password) : await register(backendUrl, email, password, values.displayName?.trim() || undefined);
            onDone({ type: "success", ...outcome });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setBusy(false);
        }
        // Sem `finally`/`setBusy(false)` no caminho de sucesso de propósito — `onDone` já desmonta este componente
        // (ver runAuthScreen), então "busy" nunca precisa voltar a `false` ali; só no erro, pra liberar o Form de novo.
    }

    const fields =
        mode === "login"
            ? [
                  { key: "email", label: "Email" },
                  { key: "password", label: "Senha", mask: "•" },
              ]
            : [
                  { key: "email", label: "Email" },
                  { key: "password", label: "Senha (mínimo 8 caracteres)", mask: "•" },
                  { key: "displayName", label: "Nome", optional: true },
              ];

    return h(
        // Preenche o terminal INTEIRO (mesmo padrão de `fullScreen` em app.ts — `height`/`width`/`backgroundColor`
        // explícitos: sem isso o Ink só pinta o que o conteúdo ocupa, deixando o resto da tela alternativa com o
        // que quer que o terminal mostre por baixo, ex: wallpaper — achado ao vivo, ver captura do dono) e centraliza
        // o Form nela (`justifyContent`/`alignItems`: Form não tem largura própria, então "centralizar" aqui é só
        // deixar o Yoga posicionar a caixa do meio do conteúdo, não algo calculado à mão).
        Box,
        { flexDirection: "column", width: columns, height: usableRows, backgroundColor: bg.base, justifyContent: "center", alignItems: "center" },
        h(
            Box,
            { flexDirection: "column", alignItems: "center" },
            h(Form, {
                key: mode,
                title: mode === "login" ? `Entrar na Helena — ${backendUrl}` : `Criar conta na Helena — ${backendUrl}`,
                fields,
                onSubmit: (values) => void handleSubmit(values),
                // Esc no cadastro volta pro login (cancela só o cadastro); no login, Esc sai do programa — mesmo
                // resultado de Ctrl+C/Ctrl+D (ver useInput acima), pra "Esc cancela" (hint fixo do Form) nunca mentir
                // sobre o que vai acontecer: sempre cancela ALGUMA coisa de verdade, nos dois modos.
                onCancel: () => {
                    if (mode === "signup") setMode("login");
                    else onDone({ type: "exit" });
                },
                submitLabel: mode === "login" ? "Enter entra" : "Enter cadastra",
                busy,
                error,
            }),
            h(Box, { marginTop: SPACE.tight }),
            h(Text, { color: theme.textMuted }, mode === "login" ? "Não tem conta? Ctrl+R cria uma" : "Já tem conta? Ctrl+L (ou Esc) volta pro login"),
        ),
    );
}
