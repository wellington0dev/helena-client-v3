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
const INDEX_HTML = readFileSync(`${DIST_DIR}/index.html`, "utf8");

export function renderPanelPage(backendUrl: string): string {
    return INDEX_HTML.replace(PLACEHOLDER, backendUrl);
}
