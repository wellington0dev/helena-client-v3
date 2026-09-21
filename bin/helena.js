#!/usr/bin/env node
// Dispatcher do comando global `helena` (CLI de chat, agora dentro de
// client/). Captura o cwd de onde a pessoa chamou `helena` ANTES de
// qualquer coisa — o processo real roda com cwd = client/ (pra
// dotenv/config achar o .env do pacote), então o diretório original só
// sobrevive via env var (HELENA_CLI_CWD, lido em src/cli/chat.ts).
//
// `agent`/`whatsapp`/`telegram` não existem mais como subcomando: viraram
// parte do client/ inteiro (rode `npm start` dentro de client/ — cobre
// canais E execução de comando na mesma máquina, ver machine-agent.ts).
// `helena` (este comando) é só o chat interativo.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(BIN_DIR, "..");

const HELP = `helena — chat interativo com a Helena

Uso: helena [comando] [--help]

  helena                          abre o chat (conecta em BACKEND_V2_URL, .env do client/)
  helena local-token rotate       gera um token local novo pra API do daemon
  helena local-token path         mostra onde está o arquivo do token (nunca imprime o token)
  helena mcp-server               inicia MCP server via stdio (expondo shell, file ops, etc)
  helena --help, -h               mostra esta ajuda

Execução de comando remoto (antigo 'helena agent'), WhatsApp e Telegram não
são mais subcomandos daqui — rode 'npm start' dentro de client/ (um
processo só cobre os três, ver docs/architecture-v2.md §4).`;

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "local-token") {
    const sub = spawnSync(process.execPath, [path.join(CLIENT_DIR, "src/cli/local-token-main.ts"), ...process.argv.slice(3)], { cwd: CLIENT_DIR, stdio: "inherit" });
    process.exit(sub.status ?? 1);
}

if (cmd === "-h" || cmd === "--help") {
    console.log(HELP);
    process.exit(0);
}

if (cmd === "mcp-server") {
    // Inicia MCP server standalone via stdio
    const result = spawnSync(process.execPath, [path.join(CLIENT_DIR, "src/mcp-server.ts")], {
        cwd: CLIENT_DIR,
        stdio: "inherit",
        env: { ...process.env, CLIENT_MCP_SERVER: "1" },
    });

    if (result.error) {
        console.error(`[helena mcp-server] falha ao executar: ${result.error.message}`);
        process.exit(1);
    }
    process.exit(result.status ?? 1);
}

if (cmd !== undefined) {
    console.error(`[helena] comando desconhecido: ${cmd}\n`);
    console.log(HELP);
    process.exit(1);
}

const result = spawnSync(process.execPath, [path.join(CLIENT_DIR, "src/cli/chat.ts")], {
    cwd: CLIENT_DIR,
    stdio: "inherit",
    env: { ...process.env, HELENA_CLI_CWD: process.cwd() },
});

if (result.error) {
    console.error(`[helena] falha ao executar: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
