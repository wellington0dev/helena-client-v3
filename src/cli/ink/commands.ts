/**
 * Registro único de comandos por barra — padrão opencode adaptado: cada
 * comando é `{name, aliases?, description, run}`, UMA fonte de verdade de
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
export type Screen = "chat" | "config" | "contacts" | "mcp" | "channels";

export interface CommandContext {
    setScreen: (screen: Screen) => void;
    pushNotice: (text: string, tone: "success" | "warn" | "danger") => void;
}

export interface Command {
    name: string;
    aliases?: string[];
    description: string;
    run: (ctx: CommandContext) => void;
}

export const COMMANDS: Command[] = [
    {
        name: "config",
        aliases: ["settings"],
        description: "Preferências — telemetria, auto-approve shell, mensagem proativa, tokens de API",
        run: (ctx) => ctx.setScreen("config"),
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
        name: "help",
        aliases: ["?"],
        description: "Esta lista",
        run: (ctx) => ctx.pushNotice(formatHelpText(), "success"),
    },
];

export function findCommand(name: string): Command | undefined {
    const normalized = name.toLowerCase();
    return COMMANDS.find((cmd) => cmd.name === normalized || cmd.aliases?.includes(normalized));
}

/** Monta o texto de `/help` a partir do registro — nunca mais uma const solta duplicando o que os comandos já descrevem. */
export function formatHelpText(): string {
    const lines = COMMANDS.map((cmd) => {
        const names = [`/${cmd.name}`, ...(cmd.aliases ?? []).map((a) => `/${a}`)];
        const namesLabel = names.length > 1 ? `${names[0]} (ou ${names.slice(1).join(", ")})` : names[0];
        return `  ${namesLabel}  ${cmd.description}`;
    });
    return ["Comandos disponíveis:", ...lines, "  Ctrl+C ou Ctrl+D        Sair"].join("\n");
}
