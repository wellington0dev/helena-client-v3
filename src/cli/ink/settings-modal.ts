import React from "react";
import { Text } from "ink";
import { getMe, setAutoApproveShell, setProactiveMessages, setTelemetryConsent, UnauthorizedError, type CurrentUser } from "../backend.ts";
import { Checkbox } from "./checkbox.ts";
import { ListModal } from "./list-modal.ts";
import type { SettingItem } from "./settings-model.ts";
import { theme } from "./theme.ts";

const h = React.createElement;

/** Para onde um item do tipo "link" leva (tela do chat que já existe). */
export type SettingsTarget = "tokens" | "permissions" | "usage" | "billing" | "limits" | "contacts" | "mcp" | "channels" | "sessions" | "telemetry-logs";

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
        { id: "billing", section: "Conta", label: "Cobrança", kind: "link", description: "Saldo de créditos em R$ e compra de mais." },
        { id: "limits", section: "Conta", label: "Limites e custos", kind: "link", description: "Limites de custo e de passos (tuas mensagens, contatos, grupos, tarefas) e como a cotação do dólar funciona." },
        { id: "telemetry-logs", section: "Conta", label: "Telemetria", kind: "link", description: "CPU/RAM da Helena em cada máquina + erros/avisos reportados (logs exigem conta admin)." },
        { id: "contacts", section: "Integrações", label: "Contatos", kind: "link", description: "Editar ou apagar contatos (WhatsApp/Telegram) e permissões extras." },
        { id: "mcp", section: "Integrações", label: "Conexões MCP", kind: "link", description: "Integrações de terceiros e o guia de como montar um servidor compatível." },
        { id: "channels", section: "Integrações", label: "Canais", kind: "link", description: "Status do WhatsApp, Telegram e da execução remota." },
        { id: "sessions", section: "Integrações", label: "Conversas recentes", kind: "link", description: "Retomar uma conversa anterior." },
    ];
}

function valuePill(item: SettingItem, busy: boolean): React.ReactElement {
    if (item.kind === "link") return h(Text, { color: theme.textMuted }, item.hint ?? "→");
    return h(Checkbox, { value: item.value, busy });
}

/** Menu de configurações (`/config`): instância do `ListModal` genérico (ver list-modal.ts) — o que fica aqui é só o
 * que é ESPECÍFICO de configurações: buscar a conta, o que "ativar" significa por item (toggle vs link) e o pill de
 * valor à direita. */
export function SettingsModal(props: SettingsModalProps): React.ReactElement {
    const { backendUrl, token, columns, usableRows, sidebarOn, onSidebarChange, onNavigate, onClose, onUnauthorized } = props;
    const [me, setMe] = React.useState<CurrentUser | undefined>(undefined);
    const [notice, setNotice] = React.useState<string | undefined>(undefined);
    const [busyId, setBusyId] = React.useState<string | undefined>(undefined);

    React.useEffect(() => {
        getMe(backendUrl, token)
            .then(setMe)
            .catch((err: unknown) => {
                if (err instanceof UnauthorizedError) onUnauthorized();
                else setNotice(`Não consegui carregar sua conta: ${err instanceof Error ? err.message : String(err)}`);
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    const items = React.useMemo(() => buildSettingItems(me, sidebarOn), [me, sidebarOn]);

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

    function activate(item: SettingItem): void {
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

    return h(ListModal<SettingItem>, {
        title: "Configurações",
        headerRight: me?.email ?? "esc fecha",
        columns,
        usableRows,
        items,
        onActivate: activate,
        onClose,
        renderRight: (item) => valuePill(item, busyId === item.id),
        emptyMessage: "Nenhuma configuração encontrada.",
        footerHint: "↑↓ ou mouse · Enter/clique alterna · roda rola · Esc fecha",
        footerOverride: notice ? { text: notice, tone: "danger" } : undefined,
    });
}
