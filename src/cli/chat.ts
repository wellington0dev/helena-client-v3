import "dotenv/config";
import os from "node:os";
import { createInterface } from "node:readline/promises";
import { config } from "../config.ts";
import { login, resolveInterrupt, sendMessage, UnauthorizedError, type PendingConfirmation, type SendMessageResult } from "./backend.ts";
import { clearSession, loadSession, saveSession } from "./session-store.ts";

/**
 * `helena` — REPL interativo, reescrito do zero contra o protocolo REAL do
 * backend-v2 (o `cli/src/chat.ts` antigo falava `/ws/panel`, um protocolo
 * do backend single-owner que não existe mais aqui). Fala EXATAMENTE o
 * mesmo protocolo que o painel Angular fala (login por email/senha, JWT,
 * `/chat/messages`, `/chat/sessions/:id/resolve`) — ver
 * client/panel-app/src/app/core/{auth,chat}.service.ts.
 *
 * `cwd`/`machineName` vão em TODO turno — o diretório de onde `helena` foi
 * chamado (HELENA_CLI_CWD, ver bin/helena.js) e o hostname desta máquina.
 * Vira contexto ADVISÓRIO pro modelo (chat.agent.ts), nunca uma restrição.
 */

const rl = createInterface({ input: process.stdin, output: process.stdout });

if (!config.backendUrl) {
    console.error("[helena] BACKEND_V2_URL não configurado no .env.");
    process.exit(1);
}

const backendUrl = config.backendUrl;
// bin/helena.js captura o cwd de ONDE a pessoa chamou `helena`, antes de
// qualquer spawn mudar o diretório de trabalho do processo — sem isso,
// process.cwd() aqui devolveria o diretório do pacote client/, não de
// onde a pessoa realmente está.
const invocationCwd = process.env.HELENA_CLI_CWD || process.cwd();
const machineName = os.hostname();

/** Prompt de senha sem eco na tela — técnica padrão sem dependência nova: suprime o que o readline escreveria de volta, exceto o próprio prompt e a quebra de linha final. */
async function questionHidden(query: string): Promise<string> {
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

async function interactiveLogin(): Promise<string> {
    console.log(`Login na Helena (${backendUrl})`);
    const email = await rl.question("Email: ");
    const password = await questionHidden("Senha: ");
    const token = await login(backendUrl, email.trim(), password);
    saveSession(token);
    return token;
}

async function ensureSession(): Promise<string> {
    const stored = loadSession();
    if (stored) return stored.accessToken;
    return interactiveLogin();
}

/** Guarda o token atual — precisa ser mutável porque `withSession` pode relogar no meio do processo e a chamada seguinte tem que usar o token novo. */
interface SessionBox {
    token: string;
}

/** Roda `action` com o token atual; se der 401, relogar UMA vez, atualizar `box.token`, e tentar de novo (sessão pode ter expirado desde a última vez). */
async function withSession<T>(box: SessionBox, action: (token: string) => Promise<T>): Promise<T> {
    try {
        return await action(box.token);
    } catch (error) {
        if (!(error instanceof UnauthorizedError)) throw error;
        clearSession();
        console.log("\n[sessão expirada — relogue]");
        box.token = await interactiveLogin();
        return action(box.token);
    }
}

/** Mesmo comportamento do cartão de confirmação do painel (chat.component.html): tool + input em JSON, aprovar/recusar bloqueia novo envio até resolver. */
async function resolvePendingLoop(box: SessionBox, sessionId: string, pending: PendingConfirmation): Promise<SendMessageResult> {
    let currentSessionId = sessionId;
    let current: PendingConfirmation | undefined = pending;
    let last: SendMessageResult | undefined;

    while (current) {
        console.log(`\n[confirmação] a Helena quer usar a tool "${current.tool}" com:`);
        console.log(JSON.stringify(current.input, null, 2));
        const answer = (await rl.question("Aprovar? (s/n) ")).trim().toLowerCase();
        const approved = answer === "s" || answer === "sim";

        last = await withSession(box, (t) => resolveInterrupt(backendUrl, t, currentSessionId, current!.tool, current!.ref, approved, approved ? undefined : "Recusado pelo usuário no CLI."));
        currentSessionId = last.sessionId;
        current = last.pending?.[0];
    }

    return last!;
}

rl.on("close", () => {
    console.log("\nAté mais!");
    process.exit(0);
});

async function main(): Promise<void> {
    const box: SessionBox = { token: await ensureSession() };
    console.log(`Conectado a ${backendUrl} (${invocationCwd}) — digite sua mensagem (Ctrl+C pra sair).\n`);

    let sessionId: string | undefined;

    while (true) {
        const input = await rl.question("Você: ").catch(() => null);
        if (input === null) return; // rl 'close' acima já cuida da saída.
        if (!input.trim()) continue;

        try {
            const result = await withSession(box, (t) => sendMessage(backendUrl, t, { text: input, sessionId, cwd: invocationCwd, machineName }));
            sessionId = result.sessionId;
            console.log(`\nHelena: ${result.text}\n`);

            const firstPending = result.pending?.[0];
            if (firstPending) {
                const final = await resolvePendingLoop(box, sessionId, firstPending);
                sessionId = final.sessionId;
                console.log(`\nHelena: ${final.text}\n`);
            }
        } catch (error) {
            console.log(`\n[erro inesperado] ${error instanceof Error ? error.message : error}`);
        }
    }
}

main();
