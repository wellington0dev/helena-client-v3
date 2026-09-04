import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { DIST_DIR, renderPanelPage } from "./page.ts";
import { getState, onStateChange } from "./status-bus.ts";

const MIME_TYPES: Record<string, string> = {
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};

/** `null` se o caminho pedido não corresponder a um arquivo real dentro de DIST_DIR (nunca escapa a pasta, mesmo com `../` no request). */
function resolveStaticFile(urlPath: string): string | null {
    const candidate = normalize(join(DIST_DIR, urlPath));
    if (!candidate.startsWith(DIST_DIR)) return null;
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return null;
    return candidate;
}

/**
 * Servidor local do painel — HTTP simples (arquivos estáticos do Angular já
 * buildado, com fallback de SPA pra qualquer rota do Router, ex: `/chat`,
 * `/perfil`) + WebSocket pra empurrar o estado dos canais (status, QR) ao
 * vivo pro navegador. Roda só em localhost por padrão — este processo tem
 * acesso à sessão do WhatsApp/token do Telegram do dono da máquina, então
 * nunca deveria ficar exposto na rede sem mais nenhuma camada de auth (fica
 * como nota pra quando isto crescer além de "só eu na minha máquina").
 */
export function startPanelServer(port: number, backendUrl: string): void {
    const server = createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
            return;
        }

        const urlPath = (req.url ?? "/").split("?")[0]!;
        const staticFile = urlPath === "/" ? null : resolveStaticFile(urlPath);
        if (staticFile) {
            res.writeHead(200, { "Content-Type": MIME_TYPES[extname(staticFile)] ?? "application/octet-stream" });
            res.end(readFileSync(staticFile));
            return;
        }

        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPanelPage(backendUrl));
    });

    const wss = new WebSocketServer({ server, path: "/ws" });

    wss.on("connection", (ws) => {
        ws.send(JSON.stringify(getState()));
    });

    onStateChange((state) => {
        const payload = JSON.stringify(state);
        for (const client of wss.clients) {
            if (client.readyState === client.OPEN) client.send(payload);
        }
    });

    server.listen(port, "127.0.0.1", () => {
        console.log(`[painel] disponível em http://localhost:${port}`);
    });
}
