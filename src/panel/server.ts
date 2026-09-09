import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer } from "ws";
import { saveSession } from "../cli/session-store.ts";
import { DIST_DIR, renderPanelPage } from "./page.ts";
import { getState, onStateChange } from "./status-bus.ts";

/**
 * O painel (Angular) e o `helena` (CLI) são processos/UIs diferentes do
 * MESMO `client/` rodando na máquina do dono — mas o JWT do painel só
 * existe no `localStorage` do NAVEGADOR (origem do backend-v2, ex:
 * `:4001`), nunca chega neste processo Node sozinho. Pedido explícito do
 * dono (2026-09-09): depois de logar no painel, `helena` (CLI) na MESMA
 * máquina deveria achar sessão pronta, sem pedir email/senha de novo.
 * `AuthService` (panel-app) manda o token pra cá via `fetch` direto (não
 * pelo `HttpClient`/interceptor, que reescreveria a URL pro backend-v2
 * remoto) logo após login/register — best-effort, nunca bloqueia o login
 * se isto falhar (ex: painel servido de outro jeito, sem este processo
 * `client/` por trás). Reusa o MESMO `session.json` que `cli/session-store.ts`
 * já lê (`ensureSession` em cli/chat.ts) — nenhum mecanismo novo, só o
 * relay que faltava entre navegador e processo Node local.
 */
function handleCliSession(req: IncomingMessage, res: ServerResponse): void {
    let body = "";
    req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 10_000) req.destroy(); // JWT nunca chega perto disso — corta cedo um corpo absurdo.
    });
    req.on("end", () => {
        try {
            const { accessToken } = JSON.parse(body) as { accessToken?: string };
            if (!accessToken) throw new Error("accessToken ausente.");
            saveSession(accessToken);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false }));
        }
    });
}

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
 * vivo pro navegador. Escuta em 0.0.0.0 (decisão explícita, 2026-09-07) —
 * este processo tem acesso à sessão do WhatsApp/token do Telegram do dono
 * da máquina, então isso só é seguro porque a máquina só é alcançável pela
 * rede privada da VPN (Tailscale) e não pela internet pública. Este
 * servidor em si não tem autenticação própria (quem alcançar a porta vê o
 * painel) — se algum dia a máquina ficar exposta fora da VPN, volte isto
 * pra "127.0.0.1" ou adicione auth aqui.
 */
/** Devolve o `http.Server` (nunca usado pelo `main.ts` real, só serve pra testes fecharem o servidor no `after()` — sem isso o socket aberto prende o event loop e `node --test` nunca termina o arquivo). */
export function startPanelServer(port: number, backendUrl: string): ReturnType<typeof createServer> {
    const server = createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
            return;
        }

        if (req.url === "/cli-session" && req.method === "POST") {
            handleCliSession(req, res);
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

    server.listen(port, "0.0.0.0", () => {
        console.log(`[painel] disponível em http://localhost:${port} (e em qualquer IP desta máquina na VPN, porta ${port})`);
    });

    return server;
}
