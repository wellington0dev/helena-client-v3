import React from "react";
import { useInput, useWindowSize } from "ink";
import { clearSessions, deleteSession, listSessionSummaries, type HistoryEntry, type SessionSummary } from "../api/sessions.ts";
import { UnauthorizedError } from "../backend.ts";
import { Confirm } from "./confirm.ts";
import { CrudScreen } from "./crud-screen.ts";
import { historyItem, type HistoryItem } from "./history-item.ts";

const h = React.createElement;

const SessionsCrudScreen = CrudScreen as unknown as (props: {
    title: string;
    items: SessionSummary[] | undefined;
    itemLabel: (item: SessionSummary) => { label: string; hint?: string };
    onSelect: (item: SessionSummary) => void;
    onDelete: (item: SessionSummary) => Promise<void>;
    deleteConfirmLabel: (item: SessionSummary) => string;
    busy: boolean;
    error?: string;
    onExit: () => void;
    maxVisible?: number;
}) => React.ReactElement;

const MAX_LABEL = 70;

/** "hoje 14:32", "ontem 09:10" ou "dd/mm 09:10" no fuso local — o suficiente pra reconhecer a conversa. */
export function formatWhen(iso: string, now = new Date()): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n: number): string => String(n).padStart(2, "0");
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
    if (days === 0) return `hoje ${time}`;
    if (days === 1) return `ontem ${time}`;
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${time}`;
}

export function sessionLabel(session: SessionSummary): string {
    const text = session.preview.trim();
    if (!text) return "(sem mensagens)";
    return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text;
}

/** Converte o histórico do backend em itens do chat — só user/assistant; o placeholder de "resposta sem texto" (turno que só chamou tool) não vira mensagem. */
export function historyEntriesToItems(entries: HistoryEntry[]): HistoryItem[] {
    const items: HistoryItem[] = [];
    for (const entry of entries) {
        if (typeof entry.text !== "string") continue;
        if (entry.role === "user") items.push(historyItem("user", entry.text));
        else if (entry.role === "assistant" && !entry.text.startsWith("(sem texto")) items.push(historyItem("assistant", entry.text));
    }
    return items;
}

/**
 * `/sessoes` — conversas recentes do dono; Enter retoma a escolhida (o `onPick` carrega o histórico no chat), `x`
 * apaga PERMANENTEMENTE (com confirmação — `CrudScreen` já garante isso), `L` maiúsculo limpa TODAS de uma vez
 * (pedido do dono, 2026-09-22 — confirmação própria aqui, mesmo padrão visual do `CrudScreen`: letra maiúscula de
 * propósito, pra nunca disparar sem querer junto de outra tecla de uma letra só). `activeSessionId`/`onDeleteActive`
 * (mesmo pedido): se a conversa apagada (uma ou todas) for a que está aberta no chat AGORA, o `App` precisa saber
 * pra soltar essa sessão (senão a próxima mensagem bateria numa sessão que não existe mais no backend).
 */
export function SessionsScreen(props: { backendUrl: string; token: string; activeSessionId?: string; onPick: (session: SessionSummary) => void; onDeleteActive: () => void; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, activeSessionId, onPick, onDeleteActive, onExit, onUnauthorized } = props;
    const [sessions, setSessions] = React.useState<SessionSummary[] | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [confirmingClearAll, setConfirmingClearAll] = React.useState(false);
    // Linhas do terminal - moldura/título/rodapé/marcadores da lista (~11); no mínimo 3 itens visíveis.
    const { rows } = useWindowSize();
    const maxVisible = Math.max(3, rows - 11);

    React.useEffect(() => {
        listSessionSummaries(backendUrl, token)
            .then(setSessions)
            .catch((err: unknown) => {
                if (err instanceof UnauthorizedError) onUnauthorized();
                else setError(err instanceof Error ? err.message : String(err));
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    async function handleDelete(session: SessionSummary): Promise<void> {
        setBusy(true);
        try {
            await deleteSession(backendUrl, token, session.id);
            setSessions((prev) => prev?.filter((s) => s.id !== session.id));
            if (session.id === activeSessionId) onDeleteActive();
        } catch (err) {
            if (err instanceof UnauthorizedError) onUnauthorized();
            else setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }

    async function handleClearAll(): Promise<void> {
        setConfirmingClearAll(false);
        setBusy(true);
        try {
            await clearSessions(backendUrl, token);
            setSessions([]);
            onDeleteActive(); // qualquer sessão ativa também acabou de ser apagada — solta a conversa no chat.
        } catch (err) {
            if (err instanceof UnauthorizedError) onUnauthorized();
            else setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }

    useInput(
        (input) => {
            // Enquanto confirma, quem trata s/n/Esc é o <Confirm> montado abaixo — nunca os dois ao mesmo tempo
            // (ver comentário em confirm.ts).
            if (confirmingClearAll) return;
            if (input === "L" && sessions && sessions.length > 0) setConfirmingClearAll(true);
        },
        { isActive: !busy },
    );

    if (confirmingClearAll) {
        return h(Confirm, {
            message: `Apagar TODAS as ${sessions?.length ?? 0} conversas permanentemente? Sem volta.`,
            onConfirm: handleClearAll,
            onCancel: () => setConfirmingClearAll(false),
        });
    }

    return h(SessionsCrudScreen, {
        title: "Conversas recentes — Enter retoma, x apaga, L (maiúsculo) limpa tudo",
        items: sessions,
        itemLabel: (session) => ({ label: sessionLabel(session), hint: formatWhen(session.updatedAt) }),
        onSelect: onPick,
        onDelete: handleDelete,
        deleteConfirmLabel: (session) => `Apagar permanentemente a conversa:\n${sessionLabel(session)}\nSem volta.`,
        busy,
        error,
        onExit,
        maxVisible,
    });
}
