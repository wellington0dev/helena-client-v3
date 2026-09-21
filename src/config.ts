import "dotenv/config";
import { loadDeviceToken } from "./device-token.ts";

/**
 * Config central do client/ — lida uma vez, aqui, em vez de cada módulo ler
 * `process.env` direto (padrão novo em relação ao cli/, que tinha essa
 * leitura espalhada em cada arquivo de canal). Nenhum campo é obrigatório
 * NESTE nível — cada canal decide por conta própria se tem o que precisa
 * pra subir (ver channels/whatsapp.ts/telegram.ts), porque o client/ deve
 * conseguir rodar só com o painel de pé, sem canal nenhum configurado
 * ainda (é o próprio propósito da Fase de configuração via navegador — ver
 * docs/architecture-v2.md §4).
 */
export const config = {
    /** Porta da API local (`/v1`). `CLIENT_LOCAL_PORT` é o nome novo; `CLIENT_PANEL_PORT` continua aceita por uma versão. */
    panelPort: Number(process.env.CLIENT_LOCAL_PORT || process.env.CLIENT_PANEL_PORT || 4100),
    /** Interface da API local. Padrão loopback; qualquer outro valor (ex.: IP da VPN) é opt-in e continua exigindo o token local. */
    localBind: process.env.CLIENT_LOCAL_BIND || "127.0.0.1",
    backendUrl: process.env.BACKEND_V2_URL || "",
    /**
     * Mutável de propósito (não `readonly`) — provisionado sozinho no
     * primeiro login (painel ou CLI, ver local-api/server.ts#handleCliSession)
     * quando ainda não existe nada salvo/no `.env`. `main.ts` lê este
     * campo de novo (não só uma vez no boot) na hora de ativar WhatsApp/
     * Telegram/execução remota, então atualizá-lo em runtime é o bastante
     * pra "destravar" tudo sem reiniciar o processo.
     */
    backendApiToken: loadDeviceToken() || "",
    whatsappAuthDir: process.env.WHATSAPP_AUTH_DIR || "./.whatsapp-auth",
    /** Pins lid→telefone aprendidos via `msg.key.senderPn` (ver channels/whatsapp.ts) — persistido em disco porque o Baileys pode nunca reenviar senderPn de novo pra alguns contatos depois da 1ª vez. */
    whatsappLidPinsFile: process.env.WHATSAPP_LID_PINS_FILE || "./.whatsapp-lid-pins.json",
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",
    /** Precisa bater com MEDIA_MAX_MB do backend-v2 (processos separados, sem config compartilhada) — ver media-resolve.service.ts lá. */
    mediaMaxMb: Number(process.env.MEDIA_MAX_MB || 25),
    /** Teto de um comando `shell` rodado com `background:true` (ver machine-agent.ts) — bem maior que os 30s do modo síncrono, mas não infinito. */
    backgroundShellTimeoutMinutes: Number(process.env.CLIENT_BACKGROUND_SHELL_TIMEOUT_MINUTES || 30),
};

export function hasBackendConfig(): boolean {
    return Boolean(config.backendUrl && config.backendApiToken);
}
