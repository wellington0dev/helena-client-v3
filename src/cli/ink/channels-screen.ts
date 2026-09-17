import React from "react";
import { Box, Text, useInput } from "ink";
import qrcodeTerminal from "qrcode-terminal";
import { connectLocalWs } from "./local-ws-client.ts";
import { theme } from "./theme.ts";
import type { ChannelStatus, ClientState } from "../../panel/status-bus.ts";

const h = React.createElement;

const STATUS_LABEL: Record<ChannelStatus, string> = {
    disconnected: "desconectado",
    connecting: "conectando...",
    qr: "aguardando escanear o QR",
    connected: "conectado",
    error: "erro",
};

function statusColor(status: ChannelStatus): string {
    if (status === "connected") return theme.success;
    if (status === "error") return theme.danger;
    if (status === "connecting" || status === "qr") return theme.warning;
    return theme.textMuted;
}

/** Desenha o QR em ASCII de forma síncrona (a lib é callback-based, mas nunca é assíncrona de verdade — só chama `cb` na volta da própria função). */
function renderQrAscii(text: string): string {
    let ascii = "";
    qrcodeTerminal.generate(text, { small: true }, (output: string) => {
        ascii = output;
    });
    return ascii;
}

/** `/canais` — dashboard read-only de status do WhatsApp/Telegram/execução remota, lendo o WS `/ws` do daemon local (`panel/server.ts`). Sem ações (mesma paridade do painel — `channels.component.ts` também só mostra status). */
export function ChannelsScreen(props: { panelPort: number; onExit: () => void }): React.ReactElement {
    const { panelPort, onExit } = props;
    const [state, setState] = React.useState<ClientState | undefined>(undefined);
    const [connectedToDaemon, setConnectedToDaemon] = React.useState(false);

    useInput((_input, key) => {
        if (key.escape) onExit();
    });

    React.useEffect(() => {
        const close = connectLocalWs(panelPort, (newState) => {
            setConnectedToDaemon(true);
            setState(newState);
        });
        return close;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panelPort]);

    if (!connectedToDaemon) {
        return h(
            Box,
            { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
            h(Text, { bold: true, color: theme.primary }, "Canais"),
            h(Text, { dimColor: true }, `Daemon local não detectado nesta máquina (porta ${panelPort}) — sem status ao vivo pra mostrar.`),
            h(Box, { marginTop: 1 }),
            h(Text, { dimColor: true }, "Esc volta"),
        );
    }

    const whatsapp = state?.whatsapp;
    const telegram = state?.telegram;
    const machineAgent = state?.machineAgent;

    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
        h(Text, { bold: true, color: theme.primary }, "Canais"),
        h(Box, { marginTop: 1 }),
        h(Text, null, "WhatsApp: ", h(Text, { color: statusColor(whatsapp?.status ?? "disconnected") }, STATUS_LABEL[whatsapp?.status ?? "disconnected"])),
        whatsapp?.status === "error" && whatsapp.error ? h(Text, { color: theme.danger, dimColor: true }, `  ${whatsapp.error}`) : null,
        whatsapp?.status === "qr" && whatsapp.qrText
            ? h(Box, { flexDirection: "column", marginTop: 1 }, h(Text, null, renderQrAscii(whatsapp.qrText)))
            : whatsapp?.status === "qr"
              ? h(Text, { dimColor: true }, "  Esta versão do daemon local não expõe o texto do QR pro terminal — atualize o client/.")
              : null,
        h(Box, { marginTop: 1 }),
        h(Text, null, "Telegram: ", h(Text, { color: statusColor(telegram?.status ?? "disconnected") }, STATUS_LABEL[telegram?.status ?? "disconnected"])),
        telegram?.status === "error" && telegram.error ? h(Text, { color: theme.danger, dimColor: true }, `  ${telegram.error}`) : null,
        h(Box, { marginTop: 1 }),
        h(
            Text,
            null,
            "Execução remota: ",
            h(Text, { color: statusColor(machineAgent?.status ?? "disconnected") }, STATUS_LABEL[machineAgent?.status ?? "disconnected"]),
        ),
        machineAgent?.status === "error" && machineAgent.error ? h(Text, { color: theme.danger, dimColor: true }, `  ${machineAgent.error}`) : null,
        h(Box, { marginTop: 1 }),
        h(Text, { dimColor: true }, "Esc volta"),
    );
}
