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

/** Só sequência de escape ANSI (mover cursor, limpar linha/tela) — nunca contém o texto digitado, pode passar direto. */
const ANSI_ESCAPE_ONLY = /^(\x1b\[[0-9;]*[A-Za-z])+$/;

/**
 * Prompt de senha MASCARADA (pedido explícito do dono, 2026-09-09) — cada
 * tecla vira um "*" na tela.
 *
 * Achado ao vivo enquanto implementava isto (testado com um pty de
 * verdade, via `python3 -c "import pty..."`, não só typecheck): a versão
 * anterior (`questionHidden`, e a que eu tinha escrito primeiro pra isto)
 * dependia de sobrescrever `rl._writeToOutput` — uma propriedade PRIVADA
 * do readline que existia em versões antigas do Node, mas SUMIU na versão
 * deste projeto (`node --version` = v26.8.1; `Object.getOwnPropertyNames
 * (Object.getPrototypeOf(rl))` só tem `constructor`/`question`). Ou seja:
 * a senha vinha sendo ecoada em TEXTO PURO na tela há tempos — a
 * sobrescrita nunca fazia nada, silenciosamente.
 *
 * Fix de verdade: intercepta no nível do STREAM (`process.stdout.write`),
 * não da instância do readline — funciona não importa a versão interna,
 * porque QUALQUER eco do readline (raw mode, TTY) tem que passar pelo
 * `write()` do stdout mais cedo ou mais tarde. Nunca confia no CONTEÚDO
 * do que o readline mandou escrever (pode ser o caractere de verdade) —
 * só usa como gatilho pra redesenhar a linha do zero com `rl.line.length`
 * asteriscos, a única fonte de verdade sobre quanto já foi digitado.
 * Sequência pura de escape ANSI passa direto (nunca carrega texto); `\r`/
 * `\n`/`\r\n` isolados (Enter) também — qualquer outra coisa é tratada
 * como "pode ter texto real dentro" e nunca é repassada como está.
 */
async function questionMasked(rl: Interface, query: string): Promise<string> {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
        const str = chunk instanceof Buffer ? chunk.toString() : String(chunk);
        if (ANSI_ESCAPE_ONLY.test(str) || str === "\r" || str === "\n" || str === "\r\n") {
            return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
        }
        return originalWrite(`\r\x1b[K${query}${"*".repeat((rl as unknown as { line: string }).line.length)}`);
    }) as typeof process.stdout.write;

    try {
        return await rl.question(query);
    } finally {
        process.stdout.write = originalWrite;
        process.stdout.write("\n");
    }
}

/** Cria e SEMPRE fecha o próprio `readline.Interface` — precisa liberar o stdin antes do Ink assumir raw mode (ver runInkSession). */
async function interactiveLogin(): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        console.log(`Login na Helena (${backendUrl})`);
        const email = await rl.question("Email: ");
        const password = await questionMasked(rl, "Senha: ");
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
