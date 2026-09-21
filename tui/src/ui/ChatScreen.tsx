import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import type { LocalApi } from "../api/client.ts";
import type { ChatSessionSummary, DoctorReport } from "../api/types.ts";
import { hasOlder, toolLabel, type Item } from "../state/chat-store.ts";
import type { ChatController } from "./use-chat.ts";
import { ChannelsScreen, ConfigScreen, OwnerScreen, UsageScreen } from "./screens.tsx";
import { StatusBar, type HubState } from "./StatusBar.tsx";
import { theme } from "./theme.ts";

const HELP = [
    "/ajuda      esta lista",
    "/nova       começa uma conversa nova",
    "/sessoes    escolhe uma conversa anterior",
    "/canais     status e QR do WhatsApp/Telegram, iniciar/parar/desvincular",
    "/dono       cadastra seu número/ID (para a Helena te reconhecer como dono)",
    "/uso        chamadas de IA por canal e por dia",
    "/config     preferências (telemetria, shell sem confirmar, mensagens proativas)",
    "/doctor     diagnóstico do daemon (backend, canais, permissões)",
    "/logout     sai da conta (a sessão é encerrada no servidor)",
    "/sair       fecha a TUI (Ctrl+C também)",
    "PageUp      carrega mensagens mais antigas",
].join("\n");

function ItemView({ item }: { item: Item }) {
    switch (item.kind) {
        case "user":
            return <text fg={theme.user}>{`› ${item.text}`}</text>;
        case "assistant":
            return <text fg={theme.assistant}>{item.text}</text>;
        case "tool":
            return <text fg={theme.tool}>{`  ● ${toolLabel(item.name, item.input)}`}</text>;
        case "usage":
            return <text fg={theme.muted}>{`  ${item.text}`}</text>;
        case "notice":
            return <text fg={item.tone === "error" ? theme.error : item.tone === "warn" ? theme.warn : theme.accent}>{`▸ ${item.text}`}</text>;
    }
}

function summarize(input: unknown): string {
    if (input && typeof input === "object") {
        const o = input as Record<string, unknown>;
        if (typeof o.command === "string") return o.command;
        if (typeof o.path === "string") return o.path;
    }
    try {
        return JSON.stringify(input) ?? "";
    } catch {
        return "";
    }
}

/**
 * Tela de conversa: janela de histórico (scrollbox), indicador ao vivo, confirmação de tool (a/r), composer e comandos
 * `/`. Fala só com a API local através do `ChatController`.
 */
export function ChatScreen(props: { api: LocalApi; chat: ChatController; hub: HubState; sessionTitle?: string; onExit: () => void; onLogout: () => void; blocked?: boolean }) {
    const { chat, api } = props;
    const { state } = chat;
    const [text, setText] = useState("");
    const [overlay, setOverlay] = useState<"none" | "sessions">("none");
    const [screen, setScreen] = useState<"chat" | "canais" | "dono" | "uso" | "config">("chat");
    const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
    const scroll = useRef<{ scrollTop: number } | null>(null);
    const previousCount = useRef(state.items.length);

    const awaiting = state.pending.length > 0;
    const composerFocused = !awaiting && overlay === "none" && !props.blocked && screen === "chat";

    // ao carregar mensagens antigas (itens entram no TOPO), mantém a leitura perto de onde estava
    useEffect(() => {
        const grew = state.items.length - previousCount.current;
        previousCount.current = state.items.length;
        if (grew > 1 && scroll.current && scroll.current.scrollTop <= 1) scroll.current.scrollTop = grew;
    }, [state.items.length]);

    useKeyboard((key) => {
        if (props.blocked || screen !== "chat") return;
        if (overlay === "sessions" && key.name === "escape") return setOverlay("none");
        if (awaiting) {
            if (key.name === "a") void chat.resolve(true);
            else if (key.name === "r" || key.name === "escape") void chat.resolve(false);
            return;
        }
        if (key.name === "pageup") {
            if (scroll.current) scroll.current.scrollTop = Math.max(0, scroll.current.scrollTop - 15);
            if (!scroll.current || scroll.current.scrollTop <= 1) void chat.loadOlder();
        }
    });

    async function command(line: string) {
        const [name] = line.slice(1).trim().split(/\s+/);
        switch (name) {
            case "ajuda":
                return chat.notice("info", HELP);
            case "nova":
                return chat.newSession();
            case "sair":
                return props.onExit();
            case "logout":
                return props.onLogout();
            case "sessoes":
                try {
                    setSessions(await api.sessions());
                    setOverlay("sessions");
                } catch (e) {
                    chat.notice("error", String(e instanceof Error ? e.message : e));
                }
                return;
            case "canais":
            case "dono":
            case "uso":
            case "config":
                return setScreen(name);
            case "doctor":
                try {
                    const report: DoctorReport = await api.doctor();
                    chat.notice(report.ok ? "info" : "warn", report.checks.map((c) => `${c.status === "ok" ? "✔" : c.status === "warn" ? "!" : "✖"} ${c.name}: ${c.detail}`).join("\n"));
                } catch (e) {
                    chat.notice("error", String(e instanceof Error ? e.message : e));
                }
                return;
            default:
                return chat.notice("warn", `Comando desconhecido: /${name}. Digite /ajuda.`);
        }
    }

    function submit(value: string) {
        const line = value.trim();
        setText("");
        if (!line || state.busy) return;
        if (line.startsWith("/")) void command(line);
        else void chat.send(line);
    }

    if (screen !== "chat") {
        const close = () => setScreen("chat");
        return (
            <box flexDirection="column" width="100%" height="100%">
                <StatusBar hub={props.hub} sessionTitle={props.sessionTitle} />
                {screen === "canais" ? <ChannelsScreen api={api} live={props.hub.channels} onClose={close} /> : null}
                {screen === "dono" ? <OwnerScreen api={api} onClose={close} /> : null}
                {screen === "uso" ? <UsageScreen api={api} onClose={close} /> : null}
                {screen === "config" ? <ConfigScreen api={api} onClose={close} /> : null}
            </box>
        );
    }

    return (
        <box flexDirection="column" width="100%" height="100%">
            <StatusBar hub={props.hub} sessionTitle={props.sessionTitle} />
            <scrollbox ref={scroll as never} flexGrow={1} flexShrink={1} minHeight={3} border title=" conversa " stickyScroll stickyStart="bottom" focused={false}>
                {hasOlder(state) ? <text fg={theme.muted}>↑ há mensagens mais antigas — PageUp para carregar</text> : null}
                {state.items.map((item) => (
                    <ItemView key={item.id} item={item} />
                ))}
            </scrollbox>
            {state.live ? <text fg={theme.warn}>{`⠶ ${state.live}`}</text> : null}
            {awaiting ? (
                <box border borderStyle="rounded" title=" confirmação necessária " flexDirection="column" paddingLeft={1} paddingRight={1} flexShrink={0}>
                    <text fg={theme.warn}>{`${state.pending[0]!.tool}: ${summarize(state.pending[0]!.input)}`}</text>
                    <text fg={theme.muted}>[a] aprovar   [r] recusar</text>
                </box>
            ) : null}
            {overlay === "sessions" ? (
                <box border title=" conversas (Enter abre · Esc fecha) " height={Math.min(14, sessions.length * 2 + 2)} flexShrink={0}>
                    <select
                        focused
                        height={Math.min(12, sessions.length * 2)}
                        options={sessions.map((s) => ({ name: s.title || s.id.slice(0, 8), description: new Date(s.updatedAt).toLocaleString("pt-BR"), value: s.id }))}
                        onSelect={(_i: number, option: { value?: unknown } | null) => {
                            setOverlay("none");
                            if (option?.value) void chat.loadSession(String(option.value));
                        }}
                    />
                </box>
            ) : null}
            <box border height={3} flexShrink={0} title={awaiting ? " aguardando sua decisão " : state.busy ? " aguarde… " : " mensagem "}>
                <input placeholder="Digite e Enter — /ajuda lista os comandos" focused={composerFocused} value={text} onInput={setText} onSubmit={submit as never} />
            </box>
        </box>
    );
}
