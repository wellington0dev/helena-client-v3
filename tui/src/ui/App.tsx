import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { LocalApiError, SUPPORTED_API_VERSION, type LocalApi } from "../api/client.ts";
import { connectEvents, type EventsConnection, type EventsStatus } from "../api/events.ts";
import type { ChannelsSnapshot, HubEvent } from "../api/types.ts";
import { ChatScreen } from "./ChatScreen.tsx";
import { LoginScreen } from "./LoginScreen.tsx";
import type { HubState } from "./StatusBar.tsx";
import { theme } from "./theme.ts";
import { useChat } from "./use-chat.ts";

export type Connect = typeof connectEvents;

/**
 * Raiz da TUI. Fases: `boot` (checa o daemon e a sessão) → `login` | `chat` | `fatal`. O chat fica montado por baixo
 * do login quando a sessão expira (`session.expired`), então a conversa não se perde.
 */
export function App(props: { api: LocalApi; connect?: Connect; onExit: () => void }) {
    const { api } = props;
    const [phase, setPhase] = useState<"boot" | "login" | "chat" | "fatal">("boot");
    const [fatal, setFatal] = useState<string | undefined>();
    const [expired, setExpired] = useState(false);
    const [hub, setHub] = useState<HubState>({});
    const chat = useChat(api);
    const chatRef = useRef(chat);
    chatRef.current = chat;

    useKeyboard((key) => {
        if (key.ctrl && key.name === "c") props.onExit();
    });

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const health = await api.health();
                if (health.apiVersion > SUPPORTED_API_VERSION) throw new LocalApiError(0, "api_version", `O daemon fala a API v${health.apiVersion} e esta TUI só entende até a v${SUPPORTED_API_VERSION}. Atualize a TUI.`);
                const status = await api.sessionStatus();
                if (alive) setPhase(status.loggedIn ? "chat" : "login");
            } catch (e) {
                if (!alive) return;
                setFatal(e instanceof LocalApiError && e.code === "daemon_unreachable" ? `${e.message}\n\nO daemon está rodando? (systemctl --user start helena-client · ou npm start em client/)` : String(e instanceof Error ? e.message : e));
                setPhase("fatal");
            }
        })();
        return () => {
            alive = false;
        };
    }, [api]);

    useEffect(() => {
        const onEvent = (event: HubEvent) => {
            if (event.type === "state") setHub((h) => ({ ...h, ...pick(event.data as Record<string, unknown>) }));
            else if (event.type.startsWith("state.")) setHub((h) => ({ ...h, ...pick({ [event.type.slice(6)]: event.data }) }));
            else if (event.type === "session.expired") {
                setExpired(true);
                setPhase("login");
            } else chatRef.current.handleHubEvent(event);
        };
        const conn: EventsConnection = (props.connect ?? connectEvents)({ baseUrl: api.baseUrl, token: api.token, onEvent, onStatus: (s: EventsStatus) => setHub((h) => ({ ...h, events: s })) });
        return () => conn.close();
    }, [api, props.connect]);

    if (phase === "boot") return <text fg={theme.muted}>conectando ao daemon…</text>;
    if (phase === "fatal") {
        return (
            <box flexDirection="column" padding={1} gap={1}>
                <text fg={theme.error}>{fatal}</text>
                <text fg={theme.muted}>Ctrl+C sai.</text>
            </box>
        );
    }
    // O estado do chat vive AQUI (useChat), então trocar pra tela de login e voltar não perde a conversa.
    if (phase === "login") {
        return (
            <LoginScreen
                api={api}
                expired={expired}
                onLoggedIn={() => {
                    setExpired(false);
                    setPhase("chat");
                }}
            />
        );
    }
    return (
        <ChatScreen
            api={api}
            chat={chat}
            hub={hub}
            onExit={props.onExit}
            onLogout={() => {
                void api.logout().finally(() => {
                    setExpired(false);
                    setPhase("login");
                });
            }}
        />
    );
}

function pick(data: Record<string, unknown>): Partial<HubState> {
    const out: Partial<HubState> = {};
    if (data.channels) out.channels = data.channels as ChannelsSnapshot;
    if (typeof data.backend === "string") out.backend = data.backend as HubState["backend"];
    return out;
}
