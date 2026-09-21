import type { ChannelsSnapshot } from "../api/types.ts";
import { theme } from "./theme.ts";

export interface HubState {
    channels?: ChannelsSnapshot;
    backend?: "ok" | "down" | "unauth";
    events?: "connecting" | "open" | "closed";
}

function dot(ok: boolean | undefined, warn?: boolean): string {
    return ok ? theme.ok : warn ? theme.warn : theme.error;
}

/** Barra de status: daemon (eventos), backend e canais — tudo vindo do Event Hub do daemon. */
export function StatusBar(props: { hub: HubState; sessionTitle?: string }) {
    const { hub } = props;
    const c = hub.channels;
    return (
        <box flexDirection="row" height={1} gap={2}>
            <text fg={dot(hub.events === "open", hub.events === "connecting")}>{"● daemon"}</text>
            <text fg={dot(hub.backend === "ok", hub.backend === undefined)}>{"● backend"}</text>
            <text fg={dot(c?.whatsapp.status === "connected", c?.whatsapp.status === "qr" || c?.whatsapp.status === "connecting")}>{"● WhatsApp"}</text>
            <text fg={dot(c?.telegram.status === "connected", c?.telegram.status === "connecting" || c?.telegram.status === "disconnected")}>{"● Telegram"}</text>
            <text fg={dot(c?.machineAgent.status === "connected", c?.machineAgent.status === "connecting")}>{"● máquina"}</text>
            <text fg={theme.muted}>{props.sessionTitle ? `· ${props.sessionTitle}` : "· nova conversa"}</text>
            <text fg={theme.muted}>{"· /ajuda"}</text>
        </box>
    );
}
