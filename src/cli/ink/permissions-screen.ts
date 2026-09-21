import React from "react";
import { Box, Text } from "ink";
import { listApprovedCommands, removeApprovedCommand, type ApprovedCommand } from "../api/approved-commands.ts";
import { getMe, UnauthorizedError } from "../backend.ts";
import { CrudScreen } from "./crud-screen.ts";
import { theme } from "./theme.ts";

const h = React.createElement;

const PermissionsCrudScreen = CrudScreen as unknown as (props: {
    title: string;
    items: ApprovedCommand[] | undefined;
    itemLabel: (item: ApprovedCommand) => { label: string; hint?: string };
    onDelete: (item: ApprovedCommand) => Promise<void>;
    deleteConfirmLabel: (item: ApprovedCommand) => string;
    busy: boolean;
    error?: string;
    onExit: () => void;
}) => React.ReactElement;

const MAX_LABEL = 70;

/** Uma linha só (comando pode ter várias) e com teto — o comando completo nunca é escondido na confirmação de remover. */
export function commandLabel(command: string, max = MAX_LABEL): string {
    const firstLine = command.split("\n")[0]!.trim();
    const multi = command.includes("\n");
    const base = firstLine.length > max ? `${firstLine.slice(0, max - 1)}…` : firstLine;
    return multi && !base.endsWith("…") ? `${base} …` : base;
}

/** "hoje", "ontem", "há N dias", "há N meses" — o suficiente pra saber se a permissão é velha. */
export function formatAge(iso: string, now = Date.now()): string {
    const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
    if (!Number.isFinite(days) || days < 0) return "";
    if (days === 0) return "aprovado hoje";
    if (days === 1) return "aprovado ontem";
    if (days < 60) return `aprovado há ${days} dias`;
    return `aprovado há ${Math.floor(days / 30)} meses`;
}

/** `/permissoes` — comandos "sempre permitidos": lista e revoga (Enter/x + confirmação). */
export function PermissionsScreen(props: { backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized } = props;
    const [commands, setCommands] = React.useState<ApprovedCommand[] | undefined>(undefined);
    const [autoApprove, setAutoApprove] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) {
            onUnauthorized();
            return;
        }
        setError(err instanceof Error ? err.message : String(err));
    }

    const reload = React.useCallback(async () => {
        try {
            setCommands(await listApprovedCommands(backendUrl, token));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reload();
        // O auto-approve global vale por cima desta lista — o dono precisa saber que ela pode não estar sendo consultada.
        getMe(backendUrl, token)
            .then((me) => setAutoApprove(me.autoApproveShell))
            .catch(() => undefined);
    }, [reload, backendUrl, token]);

    async function handleDelete(item: ApprovedCommand): Promise<void> {
        setBusy(true);
        setError(undefined);
        try {
            await removeApprovedCommand(backendUrl, token, item.id);
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    return h(
        Box,
        { flexDirection: "column" },
        autoApprove ? h(Text, { color: theme.warning }, "⚠ Auto-approve shell está LIGADO (/config): comandos rodam sem pedir, mesmo fora desta lista.") : null,
        h(PermissionsCrudScreen, {
            title: "Comandos sempre permitidos",
            items: commands,
            itemLabel: (item) => ({ label: commandLabel(item.command), hint: formatAge(item.createdAt) }),
            onDelete: handleDelete,
            deleteConfirmLabel: (item) => `Remover a permissão de:\n${item.command}\nNa próxima vez a Helena volta a pedir confirmação.`,
            busy,
            error,
            onExit,
        }),
    );
}
