import React from "react";
import { Box, Text, useInput } from "ink";
import { deleteContact, listContacts, updateContact, type Contact, type GrantableTool } from "../api/contacts.ts";
import { UnauthorizedError } from "../backend.ts";
import { CrudScreen } from "./crud-screen.ts";
import { Form } from "./form.ts";
import { c, theme } from "./theme.ts";

const h = React.createElement;

const ContactCrudScreen = CrudScreen as unknown as (props: {
    title: string;
    items: Contact[] | undefined;
    itemLabel: (item: Contact) => { label: string; hint?: string };
    onSelect: (item: Contact) => void;
    onDelete: (item: Contact) => Promise<void>;
    busy: boolean;
    error?: string;
    onExit: () => void;
}) => React.ReactElement;

const GRANTABLE_TOOLS: { key: GrantableTool; label: string }[] = [
    { key: "notes", label: "Notas" },
    { key: "tasks", label: "Tarefas" },
    { key: "events", label: "Agenda" },
];

function contactLabel(contact: Contact): { label: string; hint: string } {
    const channelLabel = contact.channel === "whatsapp" ? "WhatsApp" : "Telegram";
    return { label: contact.name?.trim() || `(sem nome) ${contact.contactId}`, hint: channelLabel };
}

/**
 * Todo sub-estado da edição (form → permissões extras) mora AQUI, num
 * único union plano owned pelo componente de topo — mesmo formato de
 * `config-screen.ts` (menu → tokens → create-token → token-created),
 * conforme o plano da Fase 1 (§1.5: o pai é dono do sub-estado, não o
 * `Form`). Uma versão anterior deixava esse sub-estado dentro de um
 * componente FILHO (`ContactEditForm` tinha seu próprio `sub`) — durante
 * a investigação de um travamento observado em testes automatizados via
 * pty, migrei pra esta forma achando que resolveria, mas o travamento
 * persistiu depois disso também (era artefato do harness de teste, não
 * do componente — ver `feedback_pty_eio_winsize.md`). Mantida assim por
 * ser mais simples e consistente com `ConfigScreen`, não porque tenha
 * corrigido bug nenhum.
 */
type ScreenState =
    | { kind: "list" }
    | { kind: "edit"; contact: Contact }
    | { kind: "grant-tools"; contact: Contact; values: Record<string, string>; grantedTools: GrantableTool[] };

/** `/contatos` — sem criação (contato nasce sozinho via mensagem externa, mesma regra do painel). */
export function ContactsScreen(props: { backendUrl: string; token: string; onExit: () => void; onUnauthorized: () => void }): React.ReactElement {
    const { backendUrl, token, onExit, onUnauthorized } = props;
    const [contacts, setContacts] = React.useState<Contact[] | undefined>(undefined);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [screen, setScreen] = React.useState<ScreenState>({ kind: "list" });

    function handleAsyncError(err: unknown): void {
        if (err instanceof UnauthorizedError) {
            onUnauthorized();
            return;
        }
        setError(err instanceof Error ? err.message : String(err));
    }

    const reload = React.useCallback(async () => {
        try {
            setContacts(await listContacts(backendUrl, token));
        } catch (err) {
            handleAsyncError(err);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, token]);

    React.useEffect(() => {
        void reload();
    }, [reload]);

    // Esc sobe: grant-tools -> edit (mesmos dados) -> list -> chat (onExit). Só reage quando NÃO estamos em "grant-tools" (essa tela trata o próprio Esc, ver GrantToolsScreen, senão ambos os useInput reagiriam ao mesmo Esc).
    useInput((_input, key) => {
        if (!key.escape) return;
        if (screen.kind === "list") onExit();
        else if (screen.kind === "edit") setScreen({ kind: "list" });
    });

    if (error) {
        return h(Box, { flexDirection: "column", borderStyle: "round", borderColor: theme.danger, paddingX: 1 }, h(Text, { color: theme.danger }, `Erro: ${error}`), h(Text, { dimColor: true }, "Esc pra voltar ao chat"));
    }

    async function handleDelete(contact: Contact): Promise<void> {
        setBusy(true);
        try {
            await deleteContact(backendUrl, token, contact.id);
            await reload();
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    async function handleSave(contact: Contact, values: Record<string, string>, grantedTools: GrantableTool[]): Promise<void> {
        setBusy(true);
        try {
            await updateContact(backendUrl, token, contact.id, {
                name: values.name || undefined,
                relationship: values.relationship || undefined,
                organization: values.organization || undefined,
                notes: values.notes || undefined,
                grantedTools,
            });
            await reload();
            setScreen({ kind: "list" });
        } catch (err) {
            handleAsyncError(err);
        } finally {
            setBusy(false);
        }
    }

    if (screen.kind === "list") {
        return h(ContactCrudScreen, {
            title: "Contatos",
            items: contacts,
            itemLabel: contactLabel,
            onSelect: (contact) => setScreen({ kind: "edit", contact }),
            onDelete: handleDelete,
            busy,
            onExit,
        });
    }

    if (screen.kind === "edit") {
        const contact = screen.contact;
        return h(Form, {
            title: `Editar contato — ${contact.channel === "whatsapp" ? "WhatsApp" : "Telegram"} ${contact.contactId}`,
            fields: [
                { key: "name", label: "Nome", initialValue: contact.name ?? "", optional: true },
                { key: "relationship", label: "Relação", initialValue: contact.relationship ?? "", optional: true },
                { key: "organization", label: "Organização", initialValue: contact.organization ?? "", optional: true },
                { key: "notes", label: "Notas (até 500 caracteres)", initialValue: contact.notes ?? "", optional: true },
            ],
            onSubmit: (values) => setScreen({ kind: "grant-tools", contact, values, grantedTools: contact.grantedTools ?? [] }),
            onCancel: () => setScreen({ kind: "list" }),
            submitLabel: "Enter avança pras permissões extras",
            busy,
        });
    }

    // screen.kind === "grant-tools"
    return h(GrantToolsScreen, {
        contactLabel: screen.contact.name ?? screen.contact.contactId,
        grantedTools: screen.grantedTools,
        busy,
        onToggle: (tool) =>
            setScreen((prev) => {
                if (prev.kind !== "grant-tools") return prev;
                const next = prev.grantedTools.includes(tool) ? prev.grantedTools.filter((t) => t !== tool) : [...prev.grantedTools, tool];
                return { ...prev, grantedTools: next };
            }),
        onSubmit: () => void handleSave(screen.contact, screen.values, screen.grantedTools),
        onBack: () => setScreen({ kind: "edit", contact: screen.contact }),
    });
}

/** Última etapa da edição de um contato — permissões extras (`grantedTools`). Tela de PRIMEIRO NÍVEL (não aninhada dentro do form), ver comentário em `ScreenState` acima sobre por quê. */
function GrantToolsScreen(props: {
    contactLabel: string;
    grantedTools: GrantableTool[];
    busy: boolean;
    onToggle: (tool: GrantableTool) => void;
    onSubmit: () => void;
    onBack: () => void;
}): React.ReactElement {
    const { contactLabel, grantedTools, busy, onToggle, onSubmit, onBack } = props;

    useInput((input, key) => {
        if (busy) return;
        if (key.escape) {
            onBack();
            return;
        }
        if (key.return) {
            onSubmit();
            return;
        }
        const index = "123".indexOf(input);
        if (index !== -1 && index < GRANTABLE_TOOLS.length) {
            onToggle(GRANTABLE_TOOLS[index]!.key);
        }
    });

    return h(
        Box,
        { flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1 },
        h(Text, { bold: true, color: theme.primary }, `Permissões extras — ${contactLabel}`),
        h(Text, { dimColor: true }, "O que este contato pode gerenciar SOZINHO (além de conversar com a Helena)."),
        h(Box, { marginTop: 1 }),
        ...GRANTABLE_TOOLS.map((tool, i) => {
            const enabled = grantedTools.includes(tool.key);
            return h(Text, { key: tool.key }, `${i + 1}) `, tool.label, "  ", enabled ? c.success("concedido") : c.muted("não concedido"));
        }),
        h(Box, { marginTop: 1 }),
        h(Text, { dimColor: true }, busy ? "salvando..." : "1-3 alterna · Enter salva · Esc volta pro formulário"),
    );
}
