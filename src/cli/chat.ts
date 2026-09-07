import "dotenv/config";
import os from "node:os";
import { createInterface, type Interface } from "node:readline/promises";
import React from "react";
import { render } from "ink";
import { config } from "../config.ts";
import { login } from "./backend.ts";
import { clearSession, loadSession, saveSession } from "./session-store.ts";
import { App, type HistoryItem, type SessionOutcome } from "./ink/app.ts";

/**
 * `helena` — REPL interativo com Ink (React pro terminal), inspirado nos
 * padrões reais do gemini-cli (histórico congelado em `<Static>`, spinner
 * de status vindo de `/ws/chat-progress` — ver ChatProgressGateway no
 * backend-v2). `React.createElement` em vez de JSX: ver comentário em
 * ink/app.ts sobre o modelo "zero build" deste pacote.
 *
 * Login (email/senha) continua por `readline` puro, ANTES de montar o Ink
 * — reimplementar prompt de senha mascarada dentro do Ink não teria ganho
 * real. `cwd`/`machineName` vão em TODO turno (ver ink/app.ts), mesmo
 * contexto advisório de antes.
 */

const h = React.createElement;

if (!config.backendUrl) {
    console.error("[helena] BACKEND_V2_URL não configurado no .env.");
    process.exit(1);
}

const backendUrl = config.backendUrl;
// bin/helena.js captura o cwd de ONDE a pessoa chamou `helena`, antes de
// qualquer spawn mudar o diretório de trabalho do processo.
const invocationCwd = process.env.HELENA_CLI_CWD || process.cwd();
const machineName = os.hostname();

/** Prompt de senha sem eco na tela — técnica padrão sem dependência nova: suprime o que o readline escreveria de volta, exceto o próprio prompt e a quebra de linha final. */
async function questionHidden(rl: Interface, query: string): Promise<string> {
    const rlInternal = rl as unknown as { _writeToOutput?: (s: string) => void; output: NodeJS.WritableStream };
    const original = rlInternal._writeToOutput?.bind(rlInternal);
    rlInternal._writeToOutput = (stringToWrite: string) => {
        if (stringToWrite === query || stringToWrite === "\r\n" || stringToWrite === "\n") rlInternal.output.write(stringToWrite);
    };
    try {
        return await rl.question(query);
    } finally {
        if (original) rlInternal._writeToOutput = original;
        process.stdout.write("\n");
    }
}

/** Cria e SEMPRE fecha o próprio `readline.Interface` — precisa liberar o stdin antes do Ink assumir raw mode (ver runInkSession). */
async function interactiveLogin(): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        console.log(`Login na Helena (${backendUrl})`);
        const email = await rl.question("Email: ");
        const password = await questionHidden(rl, "Senha: ");
        const token = await login(backendUrl, email.trim(), password);
        saveSession(token);
        return token;
    } finally {
        rl.close();
    }
}

async function ensureSession(): Promise<string> {
    const stored = loadSession();
    if (stored) return stored.accessToken;
    return interactiveLogin();
}

/** Monta o app Ink, devolve quando `onDone` disparar (Ctrl+C/Ctrl+D ou sessão expirada) — `unmount()` libera o raw mode do stdin antes do `readline` da próxima relogin poder usá-lo. */
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
        );
    });
}

async function main(): Promise<void> {
    let token = await ensureSession();
    console.log(`Conectado a ${backendUrl} (${invocationCwd}) — digite sua mensagem (Ctrl+C pra sair).\n`);

    let history: HistoryItem[] = [];
    let sessionId: string | undefined;

    while (true) {
        const outcome = await runInkSession(token, history, sessionId);
        if (outcome.type === "exit") {
            console.log("\nAté mais!");
            return;
        }

        // relogin — preserva o histórico já mostrado nesta sessão do terminal.
        history = outcome.history;
        sessionId = outcome.sessionId;
        clearSession();
        console.log("\n[sessão expirada — relogue]");
        token = await interactiveLogin();
    }
}

main();
