import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { daemon, DaemonUnavailableError } from "../api/daemon.ts";
import { getMe, setOwnerIdentity, UnauthorizedError, type CurrentUser } from "../backend.ts";
import { connectLocalWs } from "./local-ws-client.ts";
import { actionIndexOfRow, actionRows, buildChannelRows, validateBotToken, validateOwnerId, type ChannelActionId, type ChannelRow } from "./channels-model.ts";
import { Confirm } from "./confirm.ts";
import { Form } from "./form.ts";
import { useMouse, type MouseEvent } from "./mouse.ts";
import { qrModules, qrRowCount, renderQr } from "./qr-render.ts";
import { bg, panel, SPACE, theme } from "./theme.ts";
import type { ChannelStatus, ClientState } from "../../local-api/status-bus.ts";

const h = React.createElement;

function statusColor(status: ChannelStatus | undefined): string {
    if (status === "connected") return theme.success;
    if (status === "error") return theme.danger;
    if (status === "connecting" || status === "qr") return theme.warning;
    return theme.textMuted;
}

/** Linha (0-based) da 1ª linha da lista: padding do painel (1) + título (1) + linha em branco (1). O hit-test do mouse parte daqui. */
export const LIST_TOP = 3;

type Mode = { kind: "list" } | { kind: "form"; action: "tg-token" | "wa-owner" | "tg-owner" } | { kind: "confirm"; action: "wa-logout" | "wa-reset" | "tg-remove" };
type Message = { text: string; tone: "ok" | "error" };

/**
 * `/canais` — conectar e configurar WhatsApp/Telegram sem sair do terminal: gerar o QR do WhatsApp, definir o token do bot
 * do Telegram e informar seu número/ID (o backend só reconhece mensagens SUAS nesses canais depois disso). Os canais moram
 * no daemon local, então as ações vão por `api/daemon.ts`; o status ao vivo vem do WS `/ws` do daemon. Teclado completo; mouse é adicional.
 */
export function ChannelsScreen(props: { localPort: number; backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { localPort, backendUrl, token, onExit, onUnauthorized } = props;
    const { rows: terminalRows } = useWindowSize();
    const [state, setState] = React.useState<ClientState | undefined>(undefined);
    const [connectedToDaemon, setConnectedToDaemon] = React.useState(false);
    const [tokenSet, setTokenSet] = React.useState<boolean | undefined>(undefined);
    const [me, setMe] = React.useState<CurrentUser | undefined>(undefined);
    const [cursor, setCursor] = React.useState(0);
    const [mode, setMode] = React.useState<Mode>({ kind: "list" });
    const [busy, setBusy] = React.useState<string | undefined>(undefined);
    const [message, setMessage] = React.useState<Message | undefined>(undefined);
    const [formError, setFormError] = React.useState<string | undefined>(undefined);

    React.useEffect(() => {
        const close = connectLocalWs(localPort, (next) => {
            setConnectedToDaemon(true);
            setState({ ...next });
        });
        return close;
    }, [localPort]);

    const refreshTokenSet = React.useCallback(async () => {
        try {
            setTokenSet(Boolean((await daemon.channels(localPort)).telegram.tokenSet));
        } catch {
            // sem daemon: a tela já avisa; tokenSet fica como estava
        }
    }, [localPort]);
    const refreshMe = React.useCallback(async () => {
        try {
            setMe(await getMe(backendUrl, token));
        } catch (err) {
            if (err instanceof UnauthorizedError) onUnauthorized();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);
    React.useEffect(() => {
        void refreshTokenSet();
        void refreshMe();
    }, [refreshTokenSet, refreshMe]);

    // "conectou" depois de gerar QR: avisa que deu certo (o QR some sozinho porque o status deixa de ser "qr")
    const previousWhatsapp = React.useRef<ChannelStatus | undefined>(undefined);
    const whatsappStatus = state?.whatsapp.status;
    React.useEffect(() => {
        if (whatsappStatus === "connected" && (previousWhatsapp.current === "qr" || previousWhatsapp.current === "connecting")) setMessage({ text: "WhatsApp conectado.", tone: "ok" });
        previousWhatsapp.current = whatsappStatus;
    }, [whatsappStatus]);

    const rows = React.useMemo<ChannelRow[]>(
        () =>
            buildChannelRows({
                whatsapp: state?.whatsapp,
                telegram: state?.telegram,
                machineAgent: state?.machineAgent,
                telegramTokenSet: tokenSet,
                whatsappOwner: me?.whatsappOwnerNumber,
                telegramOwner: me?.telegramOwnerId,
            }),
        [state, tokenSet, me],
    );
    const actions = actionRows(rows);
    const current = actions.length === 0 ? -1 : Math.min(cursor, actions.length - 1);
    const qrVisible = mode.kind === "list" && state?.whatsapp.status === "qr" && Boolean(state.whatsapp.qrText);

    async function run(label: string, work: () => Promise<void>, okText?: string): Promise<void> {
        if (busy) return;
        setBusy(label);
        setMessage(undefined);
        try {
            await work();
            if (okText) setMessage({ text: okText, tone: "ok" });
        } catch (err) {
            if (err instanceof UnauthorizedError) onUnauthorized();
            else setMessage({ text: err instanceof Error ? err.message : String(err), tone: "error" });
        } finally {
            setBusy(undefined);
            void refreshTokenSet();
        }
    }

    function activate(id: ChannelActionId | undefined): void {
        if (!id || busy) return;
        setFormError(undefined);
        if (id === "wa-connect") void run("Conectando ao WhatsApp… o QR aparece em instantes", () => daemon.whatsappStart(localPort).then(() => undefined));
        else if (id === "wa-cancel") void run("Cancelando…", () => daemon.whatsappStop(localPort).then(() => undefined), "Conexão cancelada.");
        else if (id === "tg-reconnect")
            void run("Reconectando o bot…", async () => {
                await daemon.telegramStop(localPort);
                await daemon.telegramStart(localPort);
            }, "Bot reconectando — veja o status acima.");
        else if (id === "wa-logout" || id === "wa-reset" || id === "tg-remove") setMode({ kind: "confirm", action: id });
        else setMode({ kind: "form", action: id });
    }

    function confirm(action: "wa-logout" | "wa-reset" | "tg-remove"): void {
        setMode({ kind: "list" });
        if (action === "wa-logout") void run("Desconectando…", () => daemon.whatsappLogout(localPort).then(() => undefined), "WhatsApp desconectado e sessão apagada.");
        else if (action === "wa-reset")
            // Só apaga localmente (nunca chegou a conectar de verdade — não há sessão de servidor pra encerrar) e já reconecta pra gerar o QR na hora.
            void run("Apagando a sessão inválida e gerando um QR novo…", async () => {
                await daemon.whatsappLogout(localPort);
                await daemon.whatsappStart(localPort);
            });
        else void run("Removendo o token…", () => daemon.removeTelegramToken(localPort).then(() => undefined), "Token do bot removido.");
    }

    async function submitForm(action: "tg-token" | "wa-owner" | "tg-owner", values: Record<string, string>): Promise<void> {
        if (action === "tg-token") {
            const checked = validateBotToken(values.token ?? "");
            if (!checked.ok) return setFormError(checked.error);
            setMode({ kind: "list" });
            return run("Salvando o token e reconectando o bot…", () => daemon.setTelegramToken(localPort, checked.value).then(() => undefined), "Token salvo. O bot está reconectando — veja o status acima.");
        }
        const channel = action === "wa-owner" ? "whatsapp" : "telegram";
        const checked = validateOwnerId(channel, values.id ?? "");
        if (!checked.ok) return setFormError(checked.error);
        setMode({ kind: "list" });
        return run("Salvando…", async () => {
            await setOwnerIdentity(backendUrl, token, channel, checked.value);
            await refreshMe();
        }, channel === "whatsapp" ? "Número salvo." : "ID salvo.");
    }

    useInput(
        (_input, key) => {
            // Enquanto confirma, quem trata s/n/Esc é o <Confirm> montado abaixo — nunca os dois ao mesmo tempo
            // (ver comentário em confirm.ts).
            if (mode.kind === "confirm") return;
            if (key.escape) {
                if (qrVisible) activate("wa-cancel");
                else onExit();
            } else if (qrVisible) {
                // QR na tela: só Esc (cancela). Sem lista pra navegar.
            } else if (key.upArrow) setCursor((i) => (actions.length === 0 ? 0 : (i - 1 + actions.length) % actions.length));
            else if (key.downArrow || key.tab) setCursor((i) => (actions.length === 0 ? 0 : (i + 1) % actions.length));
            else if (key.return) activate(actions[current]?.id);
        },
        { isActive: mode.kind !== "form" },
    );

    useMouse((event: MouseEvent) => {
        const index = actionIndexOfRow(rows, event.y - LIST_TOP);
        if (event.type === "move") {
            if (index >= 0 && index !== current) setCursor(index);
        } else if (event.type === "press" && event.button === "left" && index >= 0) {
            setCursor(index);
            activate(actions[index]?.id);
        } else if (event.type === "wheelUp") setCursor((i) => (actions.length === 0 ? 0 : (i - 1 + actions.length) % actions.length));
        else if (event.type === "wheelDown") setCursor((i) => (actions.length === 0 ? 0 : (i + 1) % actions.length));
    }, mode.kind === "list" && !qrVisible && connectedToDaemon);

    if (!connectedToDaemon) {
        return h(
            Box,
            { flexDirection: "column", ...panel("surface") },
            h(Text, { bold: true, color: theme.primary }, "Canais"),
            h(Text, { color: theme.textMuted }, `Daemon local não detectado nesta máquina (porta ${localPort}) — sem status ao vivo nem ações. Suba o serviço do client.`),
            h(Box, { marginTop: SPACE.tight }),
            h(Text, { color: theme.textMuted }, "Esc volta"),
        );
    }

    if (mode.kind === "form") {
        const action = mode.action;
        const config = {
            "tg-token": {
                title: "Token do bot do Telegram",
                description: ["Crie um bot conversando com @BotFather no Telegram (/newbot) e cole aqui o token que ele te der.", "O token fica só nesta máquina (arquivo 0600) e não aparece na tela."],
                fields: [{ key: "token", label: "Token", mask: "•" }],
            },
            "wa-owner": {
                title: "Seu número no WhatsApp",
                description: ["O número do WhatsApp que VOCÊ usa, com DDI e DDD, só dígitos (ex: 5511999998888).", "Sem isso, o que você mandar por lá é tratado como mensagem de um contato qualquer."],
                fields: [{ key: "id", label: "Número", initialValue: me?.whatsappOwnerNumber ?? "" }],
            },
            "tg-owner": {
                title: "Seu ID no Telegram",
                description: ["Seu ID numérico do Telegram (não é o @usuario). Para descobrir, mande /start para @userinfobot.", "Sem isso, o que você mandar ao bot é tratado como mensagem de um contato qualquer."],
                fields: [{ key: "id", label: "ID", initialValue: me?.telegramOwnerId ?? "" }],
            },
        }[action];
        return h(Form, { ...config, onSubmit: (values) => void submitForm(action, values), onCancel: () => setMode({ kind: "list" }), busy: Boolean(busy), error: formError });
    }

    if (mode.kind === "confirm") {
        const message =
            mode.action === "wa-logout"
                ? "Desconectar o WhatsApp e apagar a sessão local? Para voltar, será preciso escanear um QR de novo."
                : mode.action === "wa-reset"
                  ? "A sessão local do WhatsApp está inválida — apagar e gerar um QR novo?"
                  : "Remover o token do bot do Telegram? O bot para de responder até você definir outro.";
        const action = mode.action;
        return h(Confirm, { message, onConfirm: () => confirm(action), onCancel: () => setMode({ kind: "list" }) });
    }

    if (qrVisible && state?.whatsapp.qrText) {
        const qrText = state.whatsapp.qrText;
        const qrLines = qrRowCount(qrModules(qrText).length);
        // moldura da tela: padding 1+1, título, instruções, margem, rodapé (+ aviso, se aparecer)
        const tooSmall = terminalRows - 1 < qrLines + 7;
        return h(
            Box,
            { flexDirection: "column", ...panel("surface") },
            h(Text, { bold: true, color: theme.primary }, "WhatsApp — escaneie o QR"),
            h(Text, { color: theme.textMuted }, "No celular: WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho."),
            tooSmall ? h(Text, { color: theme.warning }, `A janela está pequena para o QR (precisa de ~${qrLines + 7} linhas) — aumente o terminal.`) : null,
            h(Box, { marginTop: SPACE.tight }),
            h(Text, null, renderQr(qrText)),
            h(Text, { color: theme.textMuted }, "O QR renova sozinho. Esc cancela."),
        );
    }

    return h(
        Box,
        { flexDirection: "column", ...panel("surface") },
        h(Text, { bold: true, color: theme.primary }, "Canais"),
        h(Text, null, " "),
        ...rows.map((row, i) => {
            if (row.kind === "spacer") return h(Text, { key: `s-${i}` }, " ");
            if (row.kind === "header") {
                return h(Box, { key: `h-${i}` }, h(Text, { bold: true, wrap: "truncate" }, `${row.title}  `), h(Text, { color: statusColor(row.status), wrap: "truncate" }, row.statusLabel));
            }
            if (row.kind === "info") return h(Text, { key: `i-${i}`, color: row.tone === "danger" ? theme.danger : theme.textMuted, wrap: "truncate" }, `  ${row.text}`);
            const active = actions[current]?.id === row.id;
            return h(
                Box,
                { key: row.id, justifyContent: "space-between", paddingX: SPACE.tight, ...(active ? { backgroundColor: bg.selected } : {}) },
                h(Text, { bold: active, color: row.danger ? theme.danger : undefined, wrap: "truncate" }, row.label),
                row.hint ? h(Box, { flexShrink: 0, marginLeft: SPACE.loose }, h(Text, { color: theme.textMuted }, row.hint)) : null,
            );
        }),
        h(Text, null, " "),
        busy ? h(Text, { color: theme.warning, wrap: "truncate" }, `⟳ ${busy}`) : message ? h(Text, { color: message.tone === "ok" ? theme.success : theme.danger, wrap: "truncate" }, message.text) : h(Text, null, " "),
        h(Text, { color: theme.textMuted, wrap: "truncate" }, "↑↓ ou mouse · Enter/clique executa · Esc volta"),
    );
}
