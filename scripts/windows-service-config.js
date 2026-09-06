// Config compartilhada entre install-windows-service.js e
// uninstall-windows-service.js — os dois precisam identificar EXATAMENTE
// o mesmo serviço (mesmo `name`/`script`) pra node-windows encontrar a
// instalação certa na hora de desinstalar.
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const SERVICE_CONFIG = {
    name: "HelenaClient",
    description: "Helena — canais (WhatsApp/Telegram), painel local e execução de comando remoto nesta máquina.",
    script: path.join(CLIENT_DIR, "src", "main.ts"),
    workingDirectory: CLIENT_DIR,
};
