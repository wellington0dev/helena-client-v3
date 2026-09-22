import React from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import { getMe, setAutoApproveShell, setProactiveMessages, setTelemetryConsent, UnauthorizedError, type CurrentUser } from "../backend.ts";
import { looksLikeMouse, useMouse, type MouseEvent } from "./mouse.ts";
import { buildRows, descriptionLines, filterItems, hitTest, moveSelection, settingsLayout, windowRows, type SettingItem } from "./settings-model.ts";
import { bg, theme } from "./theme.ts";

const h = React.createElement;

/** Para onde um item do tipo "link" leva (tela do chat que já existe). */
export type SettingsTarget = "tokens" | "permissions" | "usage" | "billing" | "contacts" | "mcp" | "channels" | "projects" | "sessions";

export interface SettingsModalProps {
    backendUrl: string;
    token: string;
    columns: number;
    usableRows: number;
    sidebarOn: boolean;
    onSidebarChange: (on: boolean) => void;
    onNavigate: (target: SettingsTarget) => void;
    onClose: () => void;
    onUnauthorized: () => void;
}

/** Monta os itens a partir do estado atual. `me === undefined` = conta ainda carregando (toggles da conta ficam sem valor, não ativáveis). */
export function buildSettingItems(me: CurrentUser | undefined, sidebarOn: boolean): SettingItem[] {
    return [
        { id: "sidebar", section: "Interface", label: "Sessões na lateral", kind: "toggle", value: sidebarOn, description: "Lista clicável de conversas recentes + criar nova, ao lado do chat (também: /sidebar). Some sozinha em terminal estreito." },
        { id: "auto-shell", section: "Segurança", label: "Sempre permitir comandos shell", kind: "toggle", value: me?.autoApproveShell, description: "Liga: a Helena roda qualquer comando sem pedir confirmação. Desliga: ela pergunta antes de comandos que não são claramente seguros." },
        { id: "permissions", section: "Segurança", label: "Comandos sempre permitidos", kind: "link", description: 'Ver e revogar os comandos que você marcou como "sempre permitir".' },
        { id: "telemetry", section: "Privacidade", label: "Telemetria (erros/desempenho)", kind: "toggle", value: me?.telemetryConsent, description: "Envia erros e dados de desempenho para ajudar a melhorar a Helena. Não envia o conteúdo das conversas." },
        { id: "proactive", section: "Privacidade", label: "Mensagens por iniciativa própria", kind: "toggle", value: me?.allowProactiveMessages, description: "Permite que a Helena te avise sem você ter perguntado (lembretes, fim de tarefas, resultados)." },
        { id: "tokens", section: "Conta", label: "Tokens de API", kind: "link", description: "Tokens usados pelo helena agent (execução remota). Criar e revogar." },
        { id: "usage", section: "Conta", label: "Uso", kind: "link", description: "Chamadas de chat por canal e nos últimos 7 dias." },
        { id: "billing", section: "Conta", label: "Cobrança", kind: "link", description: "Saldo de tokens da plataforma e compra de mais." },
        { id: "contacts", section: "Integrações", label: "Contatos", kind: "link", description: "Editar ou apagar contatos (WhatsApp/Telegram) e permissões extras." },
        { id: "mcp", section: "Integrações", label: "Conexões MCP", kind: "link", description: "Integrações de terceiros e o guia de como montar um servidor compatível." },
        { id: "channels", section: "Integrações", label: "Canais", kind: "link", description: "Status do WhatsApp, Telegram e da execução remota." },
        { id: "projects", section: "Integrações", label: "Projetos", kind: "link", description: "Equipe de dev: criar, acompanhar, revisar e conversar com cada agente." },
        { id: "sessions", section: "Integrações", label: "Conversas recentes", kind: "link", description: "Retomar uma conversa anterior." },
    ];
}

function valuePill(item: SettingItem, busy: boolean): React.ReactElement {
    if (item.kind === "link") return h(Text, { color: theme.textMuted }, item.hint ?? "→");
    if (busy || item.value === undefined) return h(Text, { color: theme.textMuted }, " … ");
    return item.value
        ? h(Text, { backgroundColor: bg.success, color: theme.success }, " ● ligado ")
        : h(Text, { backgroundColor: bg.surface, color: theme.textMuted }, " ○ desligado ");
}

/** Menu de configurações (`/config`): modal centralizado sobre o chat. Teclado 100% funcional; mouse é adicional (ver mouse.ts). */
export function SettingsModal(props: SettingsModalProps): React.ReactElement {
    const { backendUrl, token, columns, usableRows, sidebarOn, onSidebarChange, onNavigate, onClose, onUnauthorized } = props;
    const [me, setMe] = React.useState<CurrentUser | undefined>(undefined);
    const [notice, setNotice] = React.useState<string | undefined>(undefined);
    const [busyId, setBusyId] = React.useState<string | undefined>(undefined);
    const [query, setQuery] = React.useState("");
    const [selected, setSelected] = React.useState(0);

    React.useEffect(() => {
        getMe(backendUrl, token)
            .then(setMe)
            .catch((err: unknown) => {
                if (err instanceof UnauthorizedError) onUnauthorized();
                else setNotice(`Não consegui carregar sua conta: ${err instanceof Error ? err.message : String(err)}`);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    const allItems = React.useMemo(() => buildSettingItems(me, sidebarOn), [me, sidebarOn]);
    const items = React.useMemo(() => filterItems(allItems, query), [allItems, query]);
    const rows = React.useMemo(() => buildRows(items), [items]);
    // altura do modal fixa pela lista COMPLETA — filtrar não faz o menu encolher e pular de lugar
    const layout = settingsLayout(columns, usableRows, buildRows(allItems).length);
    const current = items.length === 0 ? -1 : Math.min(selected, items.length - 1);
    const win = windowRows(rows, Math.max(0, current), layout.listRows);
    const currentItem = current >= 0 ? items[current] : undefined;

    async function toggleAccount(id: string, value: boolean, save: (next: boolean) => Promise<unknown>, field: keyof CurrentUser): Promise<void> {
        if (busyId) return;
        setBusyId(id);
        setNotice(undefined);
        setMe((prev) => (prev ? { ...prev, [field]: !value } : prev)); // otimista: vira na hora
        try {
            await save(!value);
        } catch (err) {
            setMe((prev) => (prev ? { ...prev, [field]: value } : prev)); // volta
            if (err instanceof UnauthorizedError) onUnauthorized();
            else setNotice(`Não consegui salvar: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setBusyId(undefined);
        }
    }

    function activate(item: SettingItem | undefined): void {
        if (!item) return;
        if (item.kind === "link") {
            onNavigate(item.id as SettingsTarget);
            return;
        }
        if (item.value === undefined) return; // conta ainda carregando
        if (item.id === "sidebar") onSidebarChange(!item.value);
        else if (item.id === "auto-shell") void toggleAccount(item.id, item.value, (v) => setAutoApproveShell(backendUrl, token, v), "autoApproveShell");
        else if (item.id === "telemetry") void toggleAccount(item.id, item.value, (v) => setTelemetryConsent(backendUrl, token, v), "telemetryConsent");
        else if (item.id === "proactive") void toggleAccount(item.id, item.value, (v) => setProactiveMessages(backendUrl, token, v), "allowProactiveMessages");
    }

    function select(delta: number): void {
        setSelected(moveSelection(items.length, Math.max(0, current), delta));
    }

    useInput((input, key) => {
        if (looksLikeMouse(input)) return; // tratado por useMouse
        if (key.escape) {
            if (query) setQuery("");
            else onClose();
        } else if (key.upArrow) select(-1);
        else if (key.downArrow || key.tab) select(1);
        else if (key.pageUp) select(-layout.listRows);
        else if (key.pageDown) select(layout.listRows);
        else if (key.return) activate(currentItem);
        else if (key.backspace || key.delete) setQuery((q) => q.slice(0, -1));
        else if (input === " " && query === "") activate(currentItem);
        else if (input && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(input)) {
            setQuery((q) => q + input);
            setSelected(0);
        }
    });

    useMouse((event: MouseEvent) => {
        if (event.type === "wheelUp") return select(-1);
        if (event.type === "wheelDown") return select(1);
        const hit = hitTest(layout, event.x, event.y);
        if (event.type === "move") {
            const row = hit.area === "list" ? rows[win.start + hit.row] : undefined;
            if (row?.kind === "item" && row.itemIndex !== current) setSelected(row.itemIndex);
        } else if (event.type === "press" && event.button === "left") {
            if (hit.area === "outside") return onClose();
            const row = hit.area === "list" ? rows[win.start + hit.row] : undefined;
            if (row?.kind === "item") {
                setSelected(row.itemIndex);
                activate(row.item);
            }
        }
    }, true);

    const visible = rows.slice(win.start, win.end);
    const blanks = Math.max(0, layout.listRows - visible.length);
    const description = descriptionLines(currentItem ? currentItem.description : items.length === 0 ? "Nenhuma configuração encontrada." : "", layout.innerWidth);

    return h(
        Box,
        { position: "absolute", top: layout.top, left: layout.left, width: layout.width, height: layout.height, flexDirection: "column", backgroundColor: bg.modal, paddingX: 2, paddingY: 1 },
        h(
            Box,
            { justifyContent: "space-between", width: layout.innerWidth },
            h(Text, { bold: true, color: theme.primary }, "Configurações"),
            h(Text, { color: theme.textMuted, wrap: "truncate" }, me?.email ?? "esc fecha"),
        ),
        h(
            Box,
            { width: layout.innerWidth, backgroundColor: bg.surface, paddingX: 1 },
            h(Text, { wrap: "truncate" }, query ? `⌕ ${query}${chalk.inverse(" ")}` : chalk.hex(theme.textMuted)("⌕ digite para filtrar")),
        ),
        h(Text, null, " "),
        ...visible.map((row, i) => {
            if (row.kind === "header") return h(Box, { key: `h-${row.section}-${i}`, width: layout.innerWidth, paddingX: 1 }, h(Text, { bold: true, color: theme.textMuted, wrap: "truncate" }, row.section.toUpperCase()));
            const active = row.itemIndex === current;
            return h(
                Box,
                { key: row.item.id, width: layout.innerWidth, justifyContent: "space-between", paddingX: 1, ...(active ? { backgroundColor: bg.selected } : {}) },
                h(Text, { bold: active, wrap: "truncate" }, row.item.label),
                h(Box, { flexShrink: 0, marginLeft: 1 }, valuePill(row.item, busyId === row.item.id)),
            );
        }),
        ...Array.from({ length: blanks }, (_, i) => h(Text, { key: `b-${i}` }, " ")),
        h(Text, null, " "),
        ...description.map((line, i) => h(Text, { key: `d-${i}`, color: theme.textMuted, wrap: "truncate" }, line || " ")),
        h(Text, { color: notice ? theme.danger : theme.textMuted, wrap: "truncate" }, notice ?? "↑↓ ou mouse · Enter/clique alterna · roda rola · Esc fecha"),
    );
}
