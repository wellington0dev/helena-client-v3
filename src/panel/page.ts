import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Painel real (Angular, ver `panel-app/`) — buildado separadamente
 * (`npm run build:panel`), servido daqui como arquivos estáticos por
 * `server.ts`. Único valor injetado em runtime é `BACKEND_V2_URL` (client:4101
 * e backend-v2:4001 são origens diferentes — o navegador não tem acesso ao
 * `.env` do processo Node), via substituição de texto simples de um
 * placeholder que não colide com o nome da propriedade `window.__BACKEND_V2_URL__`
 * (ver `panel-app/src/index.html`).
 */
export const DIST_DIR = fileURLToPath(new URL("../../panel-app/dist/panel-app/browser", import.meta.url));

const PLACEHOLDER = "__HELENA_BACKEND_V2_URL_PLACEHOLDER__";

/**
 * Lido A CADA CHAMADA, não cacheado num módulo top-level — bug real pego ao
 * vivo: com `const INDEX_HTML = readFileSync(...)` no carregamento do
 * módulo, um rebuild do painel (`npm run build:panel`) troca os nomes dos
 * chunks (hash de conteúdo do Angular), mas o processo `client/` já
 * rodando continua servindo o `index.html` VELHO com os hashes de ANTES —
 * o navegador pede `chunk-<hashAntigo>.js`, recebe 404 (só existe o novo
 * hash no disco), Angular nunca inicializa, painel fica em branco sem
 * erro nenhum visível. `readFileSync` aqui é barato (chamado só por
 * carregamento de página, nunca por asset) — não precisa de cache.
 */
export function renderPanelPage(backendUrl: string): string {
    const indexHtml = readFileSync(`${DIST_DIR}/index.html`, "utf8");
    return indexHtml.replace(PLACEHOLDER, backendUrl);
}
