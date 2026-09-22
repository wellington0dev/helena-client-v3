/**
 * Registro único de comandos por barra — padrão opencode adaptado: cada
 * comando é `{name, description, run}`, UMA fonte de verdade de
 * onde `/help` e o dispatcher de `app.ts` leem, em vez de duplicar texto
 * de ajuda em vários lugares e crescer um `if/else` a cada tela nova.
 *
 * `Screen` mora aqui (não em `app.ts`) pra evitar import circular: este
 * módulo precisa do tipo pra tipar `setScreen`, e `app.ts` importa deste
 * módulo — o caminho inverso criaria ciclo.
 *
 * Comandos das telas futuras (Projetos/Contatos/Integrações/Canais/
 * Cobrança/Uso) só entram aqui quando a tela correspondente for entregue
 * — nunca um `/comando` morto aparecendo no `/help` antes de existir.
 */
export type Screen = "chat" | "config" | "contacts" | "mcp" | "channels" | "usage" | "billing" | "projects" | "permissions" | "sessions" | "settings";

export interface CommandContext {
    setScreen: (screen: Screen) => void;
    pushNotice: (text: string, tone: "success" | "warn" | "danger" | "info") => void;
    /** Mostra/esconde a sidebar de sessões do chat. */
    toggleSidebar: () => void;
    /** Começa uma conversa nova (limpa a tela e solta a sessão atual). */
    newSession: () => void;
}

export interface Command {
    name: string;
    description: string;
    run: (ctx: CommandContext) => void;
}

export const COMMANDS: Command[] = [
    {
        name: "config",
        description: "Configurações — preferências, segurança, conta e atalhos (com mouse)",
        run: (ctx) => ctx.setScreen("settings"),
    },
    {
        name: "contatos",
        description: "Editar/apagar contatos (WhatsApp/Telegram) e permissões extras",
        run: (ctx) => ctx.setScreen("contacts"),
    },
    {
        name: "integracoes",
        description: "Conexões MCP (integrações de terceiros) + guia de como montar um servidor compatível",
        run: (ctx) => ctx.setScreen("mcp"),
    },
    {
        name: "canais",
        description: "Status do WhatsApp/Telegram/execução remota (só leitura)",
        run: (ctx) => ctx.setScreen("channels"),
    },
    {
        name: "uso",
        description: "Chamadas de chat por canal e nos últimos 7 dias (só leitura)",
        run: (ctx) => ctx.setScreen("usage"),
    },
    {
        name: "cobranca",
        description: "Saldo de tokens da plataforma, comprar mais",
        run: (ctx) => ctx.setScreen("billing"),
    },
    {
        name: "projetos",
        description: "Equipe de dev — criar, acompanhar, revisar, conversar com cada agente",
        run: (ctx) => ctx.setScreen("projects"),
    },
    {
        name: "sessoes",
        description: "Conversas recentes — retomar uma delas",
        run: (ctx) => ctx.setScreen("sessions"),
    },
    {
        name: "novo",
        description: "Nova conversa (limpa a tela e começa outra sessão)",
        run: (ctx) => ctx.newSession(),
    },
    {
        name: "permissoes",
        description: 'Comandos "sempre permitidos" — ver e revogar',
        run: (ctx) => ctx.setScreen("permissions"),
    },
    {
        name: "sidebar",
        description: "Mostra/esconde a sidebar de sessões (clique pra retomar ou criar nova — some sozinha em terminal estreito)",
        run: (ctx) => ctx.toggleSidebar(),
    },
    {
        name: "help",
        description: "Esta lista",
        run: (ctx) => ctx.pushNotice(formatHelpText(), "info"),
    },
];

export function findCommand(name: string): Command | undefined {
    const normalized = name.toLowerCase();
    return COMMANDS.find((cmd) => cmd.name === normalized);
}

/** Usado pelo menu de autocompletar do composer (ver app.ts) — prefixo vazio ("/" sozinho) casa com tudo, então digitar só "/" já mostra a lista inteira. Casa nome OU apelido pra "/s" também sugerir /config (apelido "settings"). */
export function matchCommands(prefix: string): Command[] {
    const normalized = prefix.toLowerCase();
    return COMMANDS.filter((cmd) => cmd.name.startsWith(normalized));
}

/** Monta o texto de `/help` a partir do registro — nunca mais uma const solta duplicando o que os comandos já descrevem. */
export function formatHelpText(): string {
    const lines = COMMANDS.map((cmd) => {
        return `  /${cmd.name}  ${cmd.description}`;
    });
    return ["Comandos disponíveis:", ...lines, "  @arquivo                Cita um arquivo do diretório aberto (autocompleta; Tab/Enter)", "  ↑ / ↓                   Mensagens anteriores (histórico salvo entre sessões)", "  \\ + Enter               Nova linha na mensagem", "  Esc                     Interrompe a resposta em andamento", "  Ctrl+C (2x) ou Ctrl+D   Sair"].join("\n");
}
