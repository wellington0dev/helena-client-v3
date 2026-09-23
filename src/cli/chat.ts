import "dotenv/config";
import os from "node:os";
import React from "react";
import { render } from "ink";
import { config } from "../config.ts";
import { reportError } from "../telemetry.ts";
import { readLocalToken } from "../local-api/local-token.ts";
import { clearSession, loadSession, saveSession } from "./session-store.ts";
import { App, type HistoryItem, type SessionOutcome } from "./ink/app.ts";
import { AuthScreen, type AuthScreenOutcome } from "./ink/auth-screen.ts";
import { MOUSE_OFF } from "./ink/mouse.ts";

/**
 * `helena` — REPL interativo com Ink (React pro terminal), fullscreen de
 * verdade (buffer alternativo, mesmo mecanismo de vim/htop — ver
 * `{ alternateScreen: true }` em `runInkSession` abaixo), spinner de
 * status vindo de `/ws/chat-progress` (ver ChatProgressGateway no
 * backend-v2). `React.createElement` em vez de JSX: ver comentário em
 * ink/app.ts sobre o modelo "zero build" deste pacote.
 *
 * Login/cadastro (`AuthScreen`, ver ink/auth-screen.ts) são Ink desde 2026-09-23 — mesmo fullscreen do chat, mesmo
 * `render()`/`onDone` de `runInkSession` (ver `runAuthScreen` abaixo). Antes era `readline` puro, no buffer normal;
 * virou Ink pra ficar consistente com o resto do app (Ctrl+R cria conta/Ctrl+L entra, erro inline, sem mais o
 * workaround de stdin "travado" na transição readline→Ink, ver nota histórica removida daqui). `cwd`/`machineName`
 * vão em TODO turno de chat (ver ink/app.ts), mesmo contexto advisório de antes.
 */

const h = React.createElement;

/**
 * O Ink entra/sai do buffer alternativo sozinho (`alternateScreen: true`,
 * ver `runInkSession`) e faz isso corretamente no caminho normal —
 * `unmount()` já escreve a sequência de saída ANTES de devolver o
 * controle. O que o Ink NÃO cobre (confirmado lendo `ink.js`: só registra
 * `process.once("beforeExit", ...)`, nada de sinal) é encerramento
 * ABRUPTO — `SIGTERM` de fora, `SIGINT` como sinal de verdade em vez de
 * tecla (não deveria acontecer aqui, já que `exitOnCtrlC: false` faz o
 * Ctrl+C virar uma tecla normal pro `useInput` do App, mas um terminal/
 * multiplexador pode mandar o sinal de outro jeito), ou um crash que leve
 * a `process.exit()`. Nesses casos o buffer alternativo ficaria preso —
 * esta é só uma rede de segurança de ÚLTIMA LINHA: escrever a sequência
 * de saída de novo quando já se saiu normalmente é inofensivo (o terminal
 * ignora), então não precisa nem rastrear estado.
 */
function forceExitAlternateScreen(): void {
    try {
        // desliga o mouse ANTES de sair da tela alternativa: senão o shell recebe lixo a cada clique
        process.stdout.write(`${MOUSE_OFF}[?1049l`);
    } catch {
        // stdout pode já estar fechado num desligamento abrupto — nada a fazer.
    }
}
process.on("exit", forceExitAlternateScreen);
process.on("SIGINT", () => {
    forceExitAlternateScreen();
    process.exit(130);
});
process.on("SIGTERM", () => {
    forceExitAlternateScreen();
    process.exit(143);
});

if (!config.backendUrl) {
    console.error("[helena] BACKEND_V2_URL não configurado no .env.");
    process.exit(1);
}

const backendUrl = config.backendUrl;
// bin/helena.js captura o cwd de ONDE a pessoa chamou `helena`, antes de
// qualquer spawn mudar o diretório de trabalho do processo.
const invocationCwd = process.env.HELENA_CLI_CWD || process.cwd();
const machineName = os.hostname();

/**
 * Best-effort: avisa o processo `client/` (daemon nesta MESMA máquina, se
 * estiver rodando) que um login acabou de acontecer — reusa o endpoint
 * que já existia pro sentido painel→CLI (ver local-api/server.ts#handleCliSession),
 * agora também na direção CLI→daemon. É o que deixa `helena login` sozinho
 * provisionar o token de longa duração (WhatsApp/Telegram/execução
 * remota) sem precisar abrir o painel nenhuma vez — mas nunca é
 * obrigatório: se o daemon não estiver rodando nesta máquina (CLI usado
 * remoto, ou o serviço ainda não instalado), falha em silêncio, o login
 * do CLI em si já terminou com sucesso de qualquer jeito.
 */
async function notifyLocalDaemon(token: string): Promise<void> {
    try {
        const localToken = readLocalToken(); // sem token = daemon nunca subiu nesta máquina
        if (!localToken) return;
        await fetch(`http://127.0.0.1:${config.localPort}/cli-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${localToken}` },
            body: JSON.stringify({ accessToken: token }),
            signal: AbortSignal.timeout(2000),
        });
    } catch {
        // Daemon não está rodando nesta máquina (ou não é a mesma máquina) — sem problema, o CLI segue com o próprio token.
    }
}

/**
 * Monta `AuthScreen` (login/cadastro) igual a `runInkSession` monta `App` — MESMO padrão (`alternateScreen: true`,
 * `exitOnCtrlC: false`, `instance.unmount()` dentro do `onDone`), ver comentário lá embaixo pra entender por que
 * `exitOnCtrlC: false` é obrigatório. Antes disto era um prompt de `readline` puro ANTES de montar o Ink — achado
 * real ao vivo na época (ver git blame/histórico deste arquivo): a transição readline→Ink deixava o stdin
 * "travado" (`_readableState.reading` preso em `true`), exigindo um workaround (`unstickStdinAfterReadline`).
 * Login virar Ink desde o início elimina essa categoria de bug inteira — nunca mais existe handoff readline→Ink,
 * só Ink→Ink (que `main()` já faz sozinho a cada relogin, comprovadamente funciona).
 */
function runAuthScreen(): Promise<AuthScreenOutcome> {
    return new Promise((resolve) => {
        const instance = render(
            h(AuthScreen, {
                backendUrl,
                onDone: (outcome) => {
                    instance.unmount();
                    resolve(outcome);
                },
            }),
            { alternateScreen: true, exitOnCtrlC: false },
        );
    });
}

async function interactiveLogin(): Promise<string> {
    const outcome = await runAuthScreen();
    if (outcome.type === "exit") {
        console.log("\nAté mais!");
        process.exit(0);
    }
    saveSession(outcome.accessToken, outcome.refreshToken);
    void notifyLocalDaemon(outcome.accessToken);
    return outcome.accessToken;
}

async function ensureSession(): Promise<string> {
    const stored = loadSession();
    if (stored) return stored.accessToken;
    return interactiveLogin();
}

/**
 * Monta o app Ink, devolve quando `onDone` disparar (Ctrl+C/Ctrl+D ou
 * sessão expirada) — `unmount()` libera o raw mode do stdin antes do
 * `readline` da próxima relogin poder usá-lo.
 *
 * `alternateScreen: true` é o mecanismo NATIVO do Ink pro fullscreen —
 * entra no buffer alternativo (+ esconde cursor) ao montar, sai (+
 * mostra cursor) ao desmontar, e já trata sozinho os casos que uma
 * implementação manual erraria fácil: ambiente não-interativo/sem TTY
 * vira no-op automático (`resolveAlternateScreenOption` em ink.js), e
 * suspender/retomar o terminal (`Ctrl+Z`) alterna o buffer certinho nos
 * dois sentidos. `main()` cria um `runInkSession` NOVO a cada relogin —
 * os prompts de email/senha entre uma sessão e outra caem no buffer
 * normal por um instante, o que é aceitável (ver comentário no topo do
 * arquivo).
 *
 * `exitOnCtrlC: false` é OBRIGATÓRIO — o padrão do Ink (`true`) intercepta
 * Ctrl+C ANTES de qualquer `useInput` da árvore (ver `use-input.js`: só
 * entrega o evento se `internal_exitOnCtrlC` for falso) e desmonta
 * sozinho, sem passar pelo `onDone` do App. Achado ao vivo via pty: com o
 * padrão, o Ctrl+C saía do buffer alternativo certinho (o unmount interno
 * do Ink cuida disso independente de quem pediu a saída) mas NUNCA
 * imprimia "Até mais!" — o `onDone` deste arquivo simplesmente não era
 * chamado. Desativando o padrão, Ctrl+C passa a se comportar IGUAL
 * Ctrl+D — os dois batem no mesmo `useInput` do App.
 */
function runInkSession(token: string, initialHistory: HistoryItem[], initialSessionId: string | undefined): Promise<SessionOutcome> {
    return new Promise((resolve) => {
        const instance = render(
            h(App, {
                backendUrl,
                token,
                invocationCwd,
                machineName,
                initialHistory,
                initialSessionId,
                onDone: (outcome: SessionOutcome) => {
                    instance.unmount();
                    resolve(outcome);
                },
            }),
            { alternateScreen: true, exitOnCtrlC: false },
        );
    });
}

/** Mutável de propósito — os handlers de erro global abaixo (registrados uma vez, fora de `main()`) precisam do JWT mais recente pra conseguir chamar `/telemetry/logs`, e o token muda a cada relogin. */
let currentToken: string | undefined;

async function main(): Promise<void> {
    let token = await ensureSession();
    currentToken = token;
    console.log(`Conectado a ${backendUrl} (${invocationCwd}) — digite sua mensagem, /help pra ver comandos, Ctrl+C pra sair.\n`);

    let history: HistoryItem[] = [];
    let sessionId: string | undefined;

    while (true) {
        const outcome = await runInkSession(token, history, sessionId);
        if (outcome.type === "exit") {
            // `instance.unmount()` (chamado dentro de `onDone`, ver
            // `runInkSession`) já restaurou o buffer normal ANTES desta
            // Promise resolver — o "Até mais!" já pousa no scrollback de
            // verdade, de volta pro shell.
            console.log("\nAté mais!");
            return;
        }

        // relogin — preserva o histórico já mostrado nesta sessão do terminal.
        history = outcome.history;
        sessionId = outcome.sessionId;
        clearSession();
        console.log("\n[sessão expirada — relogue]");
        token = await interactiveLogin();
        currentToken = token;
    }
}

/** Antes de logar, ainda não há `currentToken` — reportError já ignora silenciosamente sem token nenhum (ver telemetry.ts), então é seguro registrar isto já no topo do módulo. */
process.on("uncaughtException", (err) => reportError(err, "cli:uncaughtException", currentToken));
process.on("unhandledRejection", (reason) => reportError(reason, "cli:unhandledRejection", currentToken));

main();
