import React from "react";
import { Box, Static, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import chalk from "chalk";
import { resolveInterrupt, sendMessage, UnauthorizedError, type PendingConfirmation, type SendMessageResult } from "../backend.ts";
import { connectProgress, type ChatProgressEvent } from "./progress-client.ts";
import { renderMarkdownAnsi } from "./render-markdown.ts";

/** `ink`/`ink-text-input`/`ink-spinner` só publicam `.js` sem JSX — client/ roda `.ts` DIRETO com `node` (sem build, ver bin/helena.js), e o type-stripping nativo do Node não faz transform de JSX. `React.createElement` evita precisar de bundler só pra isto. */
const h = React.createElement;

/** `Static` é genérico (`Static<T>`), mas `createElement` não tem como instanciar esse genérico explicitamente sem JSX — este alias tipado resolve pro nosso único uso (histórico de `HistoryItem`). */
const HistoryStatic = Static as unknown as (props: { items: HistoryItem[]; children: (item: HistoryItem, index: number) => React.ReactNode }) => React.ReactElement;

export interface HistoryItem {
    id: string;
    role: "user" | "assistant";
    text: string;
}

export type SessionOutcome = { type: "exit" } | { type: "relogin"; history: HistoryItem[]; sessionId?: string };

export interface AppProps {
    backendUrl: string;
    token: string;
    invocationCwd: string;
    machineName: string;
    initialHistory?: HistoryItem[];
    initialSessionId?: string;
    onDone: (outcome: SessionOutcome) => void;
}

let nextId = 0;
function historyItem(role: HistoryItem["role"], text: string): HistoryItem {
    return { id: `h${nextId++}`, role, text };
}

function HistoryLine({ item }: { item: HistoryItem }): React.ReactElement {
    const label = item.role === "user" ? chalk.cyan.bold("Você") : chalk.magenta.bold("Helena");
    const body = item.role === "assistant" ? renderMarkdownAnsi(item.text) : item.text;
    return h(Box, { flexDirection: "column", marginBottom: 1 }, h(Text, null, `${label}:`), h(Text, null, body));
}

function StatusLine({ text }: { text: string }): React.ReactElement {
    return h(Box, { gap: 1 }, h(Text, { color: "cyan" }, h(Spinner, { type: "dots" })), h(Text, { dimColor: true }, text));
}

function Composer(props: { value: string; onChange: (v: string) => void; onSubmit: (v: string) => void; disabled: boolean }): React.ReactElement {
    return h(
        Box,
        { gap: 1 },
        h(Text, { color: "green", bold: true }, "❯"),
        h(TextInput, { value: props.value, onChange: props.onChange, onSubmit: props.onSubmit, placeholder: "Escreva sua mensagem...", focus: !props.disabled }),
    );
}

function ConfirmationPrompt(props: { pending: PendingConfirmation; onAnswer: (approved: boolean) => void }): React.ReactElement {
    useInput((input: string) => {
        const normalized = input.trim().toLowerCase();
        if (normalized === "s") props.onAnswer(true);
        else if (normalized === "n") props.onAnswer(false);
    });

    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: "yellow", paddingX: 1 },
        h(Text, { color: "yellow", bold: true }, `Aprovação necessária — ${props.pending.tool}`),
        h(Text, { dimColor: true }, JSON.stringify(props.pending.input, null, 2)),
        h(Text, null, "Aprovar? (s/n)"),
    );
}

export function App(props: AppProps): React.ReactElement {
    const { backendUrl, invocationCwd, machineName, onDone } = props;
    const [token] = React.useState(props.token);
    const [history, setHistory] = React.useState<HistoryItem[]>(props.initialHistory ?? []);
    const [sessionId, setSessionId] = React.useState<string | undefined>(props.initialSessionId);
    const [inputValue, setInputValue] = React.useState("");
    const [sending, setSending] = React.useState(false);
    const [statusLine, setStatusLine] = React.useState("Helena está pensando...");
    const [pending, setPending] = React.useState<PendingConfirmation | undefined>(undefined);
    const [error, setError] = React.useState<string | undefined>(undefined);

    // Refs pra ler o valor ATUAL de dentro do callback do WS (que só é
    // registrado uma vez no efeito abaixo) sem precisar reconectar o
    // WebSocket toda vez que `history`/`sessionId` mudam.
    const historyRef = React.useRef(history);
    historyRef.current = history;
    const sessionIdRef = React.useRef(sessionId);
    sessionIdRef.current = sessionId;
    const sendingRef = React.useRef(sending);
    sendingRef.current = sending;

    React.useEffect(() => {
        return connectProgress(backendUrl, token, (event: ChatProgressEvent) => {
            if (!sendingRef.current) return;
            if (event.type === "tool_call") setStatusLine(`Chamando ferramenta: ${event.tool}...`);
            else if (event.type === "turn_start") setStatusLine("Helena está pensando...");
        });
    }, [backendUrl, token]);

    useInput((input: string, key: { ctrl: boolean }) => {
        if (key.ctrl && (input === "c" || input === "d")) {
            onDone({ type: "exit" });
        }
    });

    async function runTurn(action: () => Promise<SendMessageResult>): Promise<void> {
        setSending(true);
        setStatusLine("Helena está pensando...");
        setError(undefined);
        try {
            const result = await action();
            setSessionId(result.sessionId);
            setHistory((prev) => [...prev, historyItem("assistant", result.text)]);
            setPending(result.pending?.[0]);
        } catch (err) {
            if (err instanceof UnauthorizedError) {
                onDone({ type: "relogin", history: historyRef.current, sessionId: sessionIdRef.current });
                return;
            }
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setSending(false);
        }
    }

    function handleSubmit(text: string): void {
        const trimmed = text.trim();
        setInputValue("");
        if (!trimmed || sending || pending) return;
        setHistory((prev) => [...prev, historyItem("user", trimmed)]);
        void runTurn(() => sendMessage(backendUrl, token, { text: trimmed, sessionId, cwd: invocationCwd, machineName }));
    }

    function handleConfirmation(approved: boolean): void {
        if (!pending || !sessionId) return;
        const current = pending;
        const activeSessionId = sessionId;
        setPending(undefined);
        void runTurn(() => resolveInterrupt(backendUrl, token, activeSessionId, current.tool, current.ref, approved, approved ? undefined : "Recusado pelo usuário no CLI."));
    }

    let liveRegion: React.ReactElement;
    if (pending) liveRegion = h(ConfirmationPrompt, { pending, onAnswer: handleConfirmation });
    else if (sending) liveRegion = h(StatusLine, { text: statusLine });
    else liveRegion = h(Composer, { value: inputValue, onChange: setInputValue, onSubmit: handleSubmit, disabled: false });

    return h(
        Box,
        { flexDirection: "column" },
        h(HistoryStatic, { items: history, children: (item: HistoryItem) => h(HistoryLine, { key: item.id, item }) }),
        error ? h(Text, { color: "red" }, `[erro] ${error}`) : null,
        liveRegion,
    );
}
