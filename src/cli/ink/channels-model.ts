/**
 * Modelo PURO da tela `/canais`: quais linhas/ações aparecem para o estado atual de cada canal, e a validação do que
 * o usuário digita. `channels-screen.ts` só desenha; o hit-test do mouse é aritmético sobre estas MESMAS linhas.
 */
import type { ChannelStatus } from "../../local-api/status-bus.ts";

export type ChannelActionId = "wa-connect" | "wa-cancel" | "wa-logout" | "wa-reset" | "wa-owner" | "tg-token" | "tg-remove" | "tg-reconnect" | "tg-owner";

export type ChannelRow =
    | { kind: "spacer" }
    | { kind: "header"; title: string; status: ChannelStatus | undefined; statusLabel: string }
    | { kind: "info"; text: string; tone: "muted" | "danger" }
    | { kind: "action"; id: ChannelActionId; label: string; hint?: string; danger?: boolean };

export interface ChannelsInput {
    whatsapp?: { status: ChannelStatus; error?: string };
    telegram?: { status: ChannelStatus; error?: string };
    machineAgent?: { status: ChannelStatus; error?: string };
    /** `undefined` = ainda não sei (consultando o daemon). */
    telegramTokenSet?: boolean;
    whatsappOwner?: string;
    telegramOwner?: string;
}

export const STATUS_LABEL: Record<ChannelStatus, string> = {
    disconnected: "desconectado",
    connecting: "conectando...",
    qr: "aguardando escanear o QR",
    connected: "conectado",
    error: "erro",
};

function ownerHint(value: string | undefined): string {
    return value ? value : "não definido";
}

export function buildChannelRows(input: ChannelsInput): ChannelRow[] {
    const rows: ChannelRow[] = [];
    const wa = input.whatsapp?.status ?? "disconnected";
    rows.push({ kind: "header", title: "WhatsApp", status: wa, statusLabel: STATUS_LABEL[wa] });
    if (wa === "error" && input.whatsapp?.error) rows.push({ kind: "info", text: input.whatsapp.error, tone: "danger" });
    if (wa === "connected") rows.push({ kind: "action", id: "wa-logout", label: "Desconectar e apagar a sessão", danger: true });
    else if (wa === "connecting" || wa === "qr") rows.push({ kind: "action", id: "wa-cancel", label: "Cancelar conexão" });
    else if (wa === "error")
        // A sessão local já está inválida (WhatsApp recusou); gerar um QR novo EXIGE apagá-la primeiro — mesma
        // natureza destrutiva de "wa-logout" (perde o histórico de pareamento local), por isso pede confirmação igual.
        rows.push({ kind: "action", id: "wa-reset", label: "Apagar sessão inválida e gerar um QR novo", danger: true });
    else rows.push({ kind: "action", id: "wa-connect", label: "Conectar e gerar QR" });
    rows.push({ kind: "action", id: "wa-owner", label: "Meu número no WhatsApp", hint: ownerHint(input.whatsappOwner) });

    const tg = input.telegram?.status ?? "disconnected";
    rows.push({ kind: "spacer" });
    rows.push({ kind: "header", title: "Telegram", status: tg, statusLabel: STATUS_LABEL[tg] });
    if (tg === "error" && input.telegram?.error) rows.push({ kind: "info", text: input.telegram.error, tone: "danger" });
    rows.push({ kind: "action", id: "tg-token", label: "Token do bot", hint: input.telegramTokenSet === undefined ? "…" : input.telegramTokenSet ? "definido — trocar" : "não definido" });
    if (input.telegramTokenSet) {
        rows.push({ kind: "action", id: "tg-reconnect", label: "Reconectar o bot" });
        rows.push({ kind: "action", id: "tg-remove", label: "Remover o token do bot", danger: true });
    }
    rows.push({ kind: "action", id: "tg-owner", label: "Meu ID no Telegram", hint: ownerHint(input.telegramOwner) });

    const agent = input.machineAgent?.status ?? "disconnected";
    rows.push({ kind: "spacer" });
    rows.push({ kind: "header", title: "Execução remota", status: agent, statusLabel: STATUS_LABEL[agent] });
    if (agent === "error" && input.machineAgent?.error) rows.push({ kind: "info", text: input.machineAgent.error, tone: "danger" });
    return rows;
}

/** Só as linhas de ação, na ordem em que o cursor as percorre. */
export function actionRows(rows: ChannelRow[]): Extract<ChannelRow, { kind: "action" }>[] {
    return rows.filter((row): row is Extract<ChannelRow, { kind: "action" }> => row.kind === "action");
}

/** Índice da linha (em `rows`) da N-ésima ação — pro hit-test do mouse (y → linha → ação). */
export function rowIndexOfAction(rows: ChannelRow[], actionIndex: number): number {
    let seen = -1;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i]!.kind === "action" && ++seen === actionIndex) return i;
    }
    return -1;
}

/** Inverso: qual ação está na linha `rowIndex` (ou -1 se a linha não é uma ação). */
export function actionIndexOfRow(rows: ChannelRow[], rowIndex: number): number {
    if (rows[rowIndex]?.kind !== "action") return -1;
    return rows.slice(0, rowIndex).filter((row) => row.kind === "action").length;
}

/** Só dígitos, com tamanho plausível. Devolve `{ok:true, value}` ou `{ok:false, error}` (mensagem pronta pra tela). */
export function validateOwnerId(channel: "whatsapp" | "telegram", raw: string): { ok: true; value: string } | { ok: false; error: string } {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return { ok: false, error: channel === "whatsapp" ? "Informe o número com DDI e DDD, só dígitos (ex: 5511999998888)." : "Informe o ID numérico do Telegram (ex: 123456789)." };
    if (channel === "whatsapp" && (digits.length < 10 || digits.length > 15)) return { ok: false, error: "Número inválido: use DDI + DDD + número (10 a 15 dígitos, ex: 5511999998888)." };
    if (channel === "telegram" && (digits.length < 5 || digits.length > 15)) return { ok: false, error: "ID inválido: o ID numérico do Telegram tem entre 5 e 15 dígitos." };
    return { ok: true, value: digits };
}

/** Formato do token do @BotFather: `<id numérico>:<segredo>`. Só pré-validação — quem decide de verdade é o daemon/Telegram. */
export function validateBotToken(raw: string): { ok: true; value: string } | { ok: false; error: string } {
    const token = raw.trim();
    if (!token) return { ok: false, error: "Cole o token que o @BotFather te deu." };
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) return { ok: false, error: "Esse não parece um token do @BotFather (formato 123456789:AAE...)." };
    return { ok: true, value: token };
}
