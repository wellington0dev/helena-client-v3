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
export type Screen = "chat" | "config" | "contacts" | "mcp" | "channels" | "usage" | "billing" | "projects" | "permissions" | "sessions" | "settings" | "telemetry";

export interface CommandContext {
    setScreen: (screen: Screen) => void;
    pushNotice: (text: string, tone: "success" | "warn" | "danger" | "info") => void;
    /** Mostra/esconde a sidebar de sessões do chat. */
    toggleSidebar: () => void;
    /** Começa uma conversa nova (limpa a tela e solta a sessão atual). */
    newSession: () => void;
    /** Sai da conta atual (revoga a sessão no backend, best-effort) e volta pra tela de login. */
    logout: () => void;
}

export interface Command {
    name: string;
    /** Agrupamento no menu de comandos (Ctrl+P, ver command-palette.ts) — mesmo campo/mesmo agrupamento visual do menu de configurações (settings-model.ts). */
    section: string;
    description: string;
    run: (ctx: CommandContext) => void;
}

// Ordem AQUI é a do "/" no composer e do /help — não mexer só por causa do agrupamento visual do menu de comandos
// (Ctrl+P, ver command-palette.ts): ele reagrupa por `section` na hora de desenhar, sem depender da ordem deste
// array (`commands.test.ts` já fixa esta ordem/relação pra matchCommands).
export const COMMANDS: Command[] = [
    {
        name: "config",
        section: "Conta",
        description: "Configurações — preferências, segurança, conta e atalhos (com mouse)",
        run: (ctx) => ctx.setScreen("settings"),
    },
    {
        name: "contatos",
        section: "Integrações",
        description: "Editar/apagar contatos (WhatsApp/Telegram) e permissões extras",
        run: (ctx) => ctx.setScreen("contacts"),
    },
    {
        name: "integracoes",
        section: "Integrações",
        description: "Conexões MCP (integrações de terceiros) + guia de como montar um servidor compatível",
        run: (ctx) => ctx.setScreen("mcp"),
    },
    {
        name: "canais",
        section: "Integrações",
        description: "Status do WhatsApp/Telegram/execução remota (só leitura)",
        run: (ctx) => ctx.setScreen("channels"),
    },
    {
        name: "uso",
        section: "Conta",
        description: "Chamadas de chat por canal e nos últimos 7 dias (só leitura)",
        run: (ctx) => ctx.setScreen("usage"),
    },
    {
        name: "telemetria",
        section: "Conta",
        description: "CPU/RAM da Helena em cada máquina + logs de erro/aviso (logs exigem conta admin)",
        run: (ctx) => ctx.setScreen("telemetry"),
    },
    {
        name: "cobranca",
        section: "Conta",
        description: "Saldo de tokens da plataforma, comprar mais",
        run: (ctx) => ctx.setScreen("billing"),
    },
    {
        name: "projetos",
        section: "Integrações",
        description: "Equipe de dev — criar, acompanhar, revisar, conversar com cada agente",
        run: (ctx) => ctx.setScreen("projects"),
    },
    {
        name: "sessoes",
        section: "Conversa",
        description: "Conversas recentes — retomar uma delas",
        run: (ctx) => ctx.setScreen("sessions"),
    },
    {
        name: "novo",
        section: "Conversa",
        description: "Nova conversa (limpa a tela e começa outra sessão)",
        run: (ctx) => ctx.newSession(),
    },
    {
        name: "permissoes",
        section: "Conta",
        description: 'Comandos "sempre permitidos" — ver e revogar',
        run: (ctx) => ctx.setScreen("permissions"),
    },
    {
        name: "sidebar",
        section: "Conversa",
        description: "Mostra/esconde a sidebar de sessões (clique pra retomar ou criar nova — some sozinha em terminal estreito)",
        run: (ctx) => ctx.toggleSidebar(),
    },
    {
        name: "logout",
        section: "Conta",
        description: "Sai da conta atual (revoga a sessão) e volta pra tela de login",
        run: (ctx) => ctx.logout(),
    },
    {
        name: "help",
        section: "Ajuda",
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
    return ["Comandos disponíveis:", ...lines, "  @arquivo                Cita um arquivo do diretório aberto (autocompleta; Tab/Enter)", "  ↑ / ↓                   Mensagens anteriores (histórico salvo entre sessões)", "  \\ + Enter               Nova linha na mensagem", "  Ctrl+P                  Abre esta mesma lista num modal, agrupada por seção", "  Esc                     Interrompe a resposta em andamento", "  Ctrl+C (2x) ou Ctrl+D   Sair"].join("\n");
}
