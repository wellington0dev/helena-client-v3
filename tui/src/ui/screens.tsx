import { useKeyboard } from "@opentui/react";
import { registerQRCode } from "@opentui/qrcode/react";
import { useEffect, useState } from "react";
import type { LocalApi } from "../api/client.ts";
import type { ChannelsSnapshot, Me, UsageSummary } from "../api/types.ts";
import { theme } from "./theme.ts";

registerQRCode(); // habilita o elemento <qr-code> (também traz a tipagem dele)

/**
 * Telas que substituem o painel web removido (plano §5.1): canais (QR + ações), identidade de dono, uso e
 * preferências. Cada uma é aberta por comando `/` e fechada com Esc; o chat continua vivo por baixo.
 */
const STATUS_LABEL: Record<string, string> = { disconnected: "desconectado", connecting: "conectando…", qr: "aguardando o QR", connected: "conectado", error: "erro" };
const statusColor = (s: string) => (s === "connected" ? theme.ok : s === "error" ? theme.error : s === "disconnected" ? theme.muted : theme.warn);

function Frame(props: { title: string; hint: string; children?: React.ReactNode }) {
    return (
        <box flexDirection="column" flexGrow={1} border borderStyle="rounded" title={` ${props.title} `} padding={1} gap={1}>
            {props.children}
            <text fg={theme.muted}>{props.hint}</text>
        </box>
    );
}

/** `/canais`: status ao vivo (vem do hub), QR do WhatsApp e ações (iniciar/parar/desvincular, token do Telegram). */
export function ChannelsScreen(props: { api: LocalApi; live?: ChannelsSnapshot; onClose: () => void }) {
    const [snap, setSnap] = useState<ChannelsSnapshot | undefined>(props.live);
    const [msg, setMsg] = useState<string | undefined>();
    const [tokenMode, setTokenMode] = useState(false);
    const [token, setToken] = useState("");
    const [confirmLogout, setConfirmLogout] = useState(false);

    useEffect(() => {
        props.api.channels().then(setSnap).catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
    }, [props.api]);
    useEffect(() => {
        if (props.live) setSnap((prev) => ({ ...prev, ...props.live, telegram: { ...props.live!.telegram, tokenSet: prev?.telegram.tokenSet } }) as ChannelsSnapshot);
    }, [props.live]);

    async function run(label: string, fn: () => Promise<void>) {
        setMsg(`${label}…`);
        try {
            await fn();
            setMsg(`${label}: ok`);
        } catch (e) {
            setMsg(`${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    useKeyboard((key) => {
        if (tokenMode) {
            if (key.name === "escape") setTokenMode(false);
            return;
        }
        if (confirmLogout) {
            if (key.name === "y") {
                setConfirmLogout(false);
                void run("Desvincular WhatsApp", () => props.api.channelAction("whatsapp", "logout"));
            } else setConfirmLogout(false);
            return;
        }
        if (key.name === "escape") return props.onClose();
        if (key.name === "w") void run("Iniciar WhatsApp", () => props.api.channelAction("whatsapp", "start"));
        else if (key.name === "x") void run("Parar WhatsApp", () => props.api.channelAction("whatsapp", "stop"));
        else if (key.name === "l") setConfirmLogout(true);
        else if (key.name === "t") void run("Iniciar Telegram", () => props.api.channelAction("telegram", "start"));
        else if (key.name === "s") void run("Parar Telegram", () => props.api.channelAction("telegram", "stop"));
        else if (key.name === "k") setTokenMode(true);
        else if (key.name === "d") void run("Remover token do Telegram", () => props.api.clearTelegramToken());
    });

    const wa = snap?.whatsapp;
    const tg = snap?.telegram;
    const ma = snap?.machineAgent;
    return (
        <Frame title="canais" hint="[w] iniciar WA  [x] parar WA  [l] desvincular WA  [t] iniciar TG  [s] parar TG  [k] token TG  [d] remover token  [Esc] volta">
            <text fg={statusColor(wa?.status ?? "disconnected")}>{`WhatsApp   ${STATUS_LABEL[wa?.status ?? "disconnected"]}${wa?.error ? ` — ${wa.error}` : ""}`}</text>
            <text fg={statusColor(tg?.status ?? "disconnected")}>{`Telegram   ${STATUS_LABEL[tg?.status ?? "disconnected"]}${tg?.tokenSet ? "" : " (sem token)"}${tg?.error ? ` — ${tg.error}` : ""}`}</text>
            <text fg={statusColor(ma?.status ?? "disconnected")}>{`Máquina    ${STATUS_LABEL[ma?.status ?? "disconnected"]}${ma?.machineName ? ` (${ma.machineName})` : ""}`}</text>
            {wa?.status === "qr" && wa.qrText ? (
                <box flexDirection="column" alignItems="center">
                    <text fg={theme.warn}>Escaneie no WhatsApp: Aparelhos conectados → Conectar um aparelho</text>
                    <qr-code content={wa.qrText} width={44} height={22} />
                </box>
            ) : null}
            {confirmLogout ? <text fg={theme.warn}>Desvincular apaga a sessão local e exige um QR novo. Confirma? [y] sim · qualquer tecla cancela</text> : null}
            {tokenMode ? (
                <box border height={3} title=" token do bot (Enter salva · Esc cancela) ">
                    <input
                        focused
                        placeholder="123456789:AA..."
                        value={token}
                        onInput={setToken}
                        onSubmit={(() => {
                            const value = token.trim();
                            setToken("");
                            setTokenMode(false);
                            if (value) void run("Salvar token do Telegram", () => props.api.setTelegramToken(value));
                        }) as never}
                    />
                </box>
            ) : null}
            {msg ? <text fg={theme.accent}>{msg}</text> : null}
        </Frame>
    );
}

/** `/dono`: "meu WhatsApp/Telegram é este número" — sem isso o dono é tratado como contato externo nesse canal. */
export function OwnerScreen(props: { api: LocalApi; onClose: () => void }) {
    const [me, setMe] = useState<Me | undefined>();
    const [channel, setChannel] = useState<"whatsapp" | "telegram">("whatsapp");
    const [value, setValue] = useState("");
    const [msg, setMsg] = useState<string | undefined>();

    useEffect(() => {
        props.api.me().then(setMe).catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
    }, [props.api]);

    useKeyboard((key) => {
        if (key.name === "escape") return props.onClose();
        if (key.name === "tab") setChannel((c) => (c === "whatsapp" ? "telegram" : "whatsapp"));
    });

    async function save() {
        const digits = value.replace(/\D/g, "");
        if (!digits) return setMsg("Informe só números (com DDI/DDD para o WhatsApp; o ID numérico para o Telegram).");
        try {
            await props.api.backend("PATCH", "auth/me/owner-identity", { channel, contactId: digits });
            setMe(await props.api.me());
            setValue("");
            setMsg("Identidade salva.");
        } catch (e) {
            setMsg(e instanceof Error ? e.message : String(e));
        }
    }

    return (
        <Frame title="identidade de dono" hint="Tab troca o canal · Enter salva · Esc volta">
            <text fg={theme.text}>{`WhatsApp: ${me?.whatsappOwnerNumber ?? "—"}    Telegram: ${me?.telegramOwnerId ?? "—"}`}</text>
            <text fg={theme.accent}>{`Canal a cadastrar: ${channel === "whatsapp" ? "WhatsApp (número com DDI+DDD, ex.: 5511999998888)" : "Telegram (ID numérico do seu usuário)"}`}</text>
            <box border height={3} title=" número / ID ">
                <input focused placeholder="somente dígitos" value={value} onInput={setValue} onSubmit={(() => void save()) as never} />
            </box>
            {msg ? <text fg={theme.accent}>{msg}</text> : null}
        </Frame>
    );
}

const CHANNEL_LABELS: Record<string, string> = { panel: "Chat", whatsapp: "WhatsApp", telegram: "Telegram", cli: "APP/CLI" };

/** `/uso`: chamadas de IA por canal e nos últimos 7 dias. */
export function UsageScreen(props: { api: LocalApi; onClose: () => void; today?: Date }) {
    const [usage, setUsage] = useState<UsageSummary | undefined>();
    const [msg, setMsg] = useState<string | undefined>();
    useEffect(() => {
        props.api.backend<UsageSummary>("GET", "dashboard/usage").then(setUsage).catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
    }, [props.api]);
    useKeyboard((key) => {
        if (key.name === "escape") props.onClose();
    });

    const days: Array<{ date: string; calls: number }> = [];
    if (usage) {
        const by = new Map(usage.callsByDay.map((d) => [d.date, d.calls]));
        const today = props.today ?? new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const iso = d.toISOString().slice(0, 10);
            days.push({ date: iso, calls: by.get(iso) ?? 0 });
        }
    }
    const max = Math.max(1, ...days.map((d) => d.calls));
    return (
        <Frame title="uso" hint="Esc volta">
            {usage ? (
                <>
                    <text fg={theme.text}>{`Total de chamadas: ${usage.totalCalls}`}</text>
                    <text fg={theme.text}>{Object.keys(CHANNEL_LABELS).map((k) => `${CHANNEL_LABELS[k]}: ${usage.callsByChannel[k] ?? 0}`).join("   ")}</text>
                    <box flexDirection="column">
                        {days.map((d) => (
                            <text key={d.date} fg={theme.accent}>{`${d.date}  ${"█".repeat(Math.round((d.calls / max) * 30)).padEnd(30)} ${d.calls}`}</text>
                        ))}
                    </box>
                </>
            ) : (
                <text fg={theme.muted}>{msg ?? "carregando…"}</text>
            )}
        </Frame>
    );
}

/** `/config`: preferências que valem em todos os seus dispositivos (ficam no backend). */
export function ConfigScreen(props: { api: LocalApi; onClose: () => void }) {
    const [me, setMe] = useState<Me | undefined>();
    const [msg, setMsg] = useState<string | undefined>();
    useEffect(() => {
        props.api.me().then(setMe).catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
    }, [props.api]);

    const toggles: Array<{ key: string; label: string; field: keyof Me; path: string; body: (v: boolean) => unknown }> = [
        { key: "1", label: "Enviar logs de erro/desempenho (telemetria)", field: "telemetryConsent", path: "auth/me/telemetry-consent", body: (v) => ({ consent: v }) },
        { key: "2", label: "Sempre permitir comandos shell (sem confirmar)", field: "autoApproveShell", path: "auth/me/auto-approve-shell", body: (v) => ({ enabled: v }) },
        { key: "3", label: "Helena pode mandar mensagem por iniciativa própria", field: "allowProactiveMessages", path: "auth/me/allow-proactive-messages", body: (v) => ({ enabled: v }) },
    ];

    useKeyboard((key) => {
        if (key.name === "escape") return props.onClose();
        const t = toggles.find((x) => x.key === key.name);
        if (!t || !me) return;
        const next = !(me[t.field] as boolean);
        props.api.backend("PATCH", t.path, t.body(next)).then(() => setMe({ ...me, [t.field]: next })).catch((e) => setMsg(String(e instanceof Error ? e.message : e)));
    });

    return (
        <Frame title="preferências" hint="Tecle 1, 2 ou 3 para alternar · Esc volta">
            {me ? toggles.map((t) => <text key={t.key} fg={(me[t.field] as boolean) ? theme.ok : theme.muted}>{`[${t.key}] ${(me[t.field] as boolean) ? "●" : "○"} ${t.label}`}</text>) : <text fg={theme.muted}>{msg ?? "carregando…"}</text>}
            {me?.autoApproveShell ? <text fg={theme.warn}>Atenção: com "sempre permitir shell" ligado, um texto malicioso lido pela Helena poderia disparar comandos sem confirmação.</text> : null}
            {msg && me ? <text fg={theme.error}>{msg}</text> : null}
        </Frame>
    );
}
