> ⚠️ **Substituído por `docs/local-api.md`** (API local `/v1`, com token local e bind em loopback). Este documento descreve o servidor antigo do painel.

# API do servidor local (`client/src/panel/server.ts`)

Documentado em 2026-09-17, quando o painel web (Angular, `panel-app/`) foi
desabilitado como interface principal — a CLI (`helena`) passa a ser a
interface principal. O **código-fonte do painel continua no repositório**,
intacto (`panel-app/`), só não é mais buildado (`npm run build:panel`
removido de `install.sh`) nem servido por este processo. Pra retomar o
desenvolvimento dele depois, veja a seção final.

Este servidor roda dentro do MESMO processo do daemon (`client/src/main.ts`),
na porta `CLIENT_PANEL_PORT` (`.env`, default 4100) — a CLI (`cli/`) é o
mesmo pacote/máquina, então fala com ele direto por `localhost`. Escuta em
`0.0.0.0` (alcançável por qualquer IP da VPN Tailscale desta máquina) — ver
comentário de segurança em `server.ts`.

## `GET /health`

Sem auth. Resposta: `{"status": "ok"}`. Só confirma que o processo está de
pé — não reflete estado de canal nenhum (isso é o `/ws`, abaixo).

## `POST /cli-session`

Sem auth própria — é o mecanismo que sincroniza "um login aconteceu nesta
máquina" entre as diferentes interfaces do `client/`. Corpo: `{"accessToken":
"<jwt>"}`.

O que acontece ao receber:
1. `saveSession(accessToken)` — grava em `~/.config/helena/session.json`,
   o MESMO arquivo que `cli/session-store.ts` lê. Efeito: se você loga
   numa interface (hoje só a própria CLI se auto-notifica via
   `notifyLocalDaemon`, ver `cli/chat.ts`), a sessão fica pronta pra
   qualquer OUTRO processo `helena` nesta máquina, sem pedir email/senha
   de novo.
2. `ensureDeviceToken(accessToken)` (fire-and-forget, nunca bloqueia a
   resposta) — se esta máquina ainda não tem um token de API de longa
   duração (`~/.config/helena/device-token.json`), provisiona um sozinho
   via `POST /auth/api-tokens` no backend-v2, usando o JWT recém-chegado.
   É o que ativa WhatsApp/Telegram/execução remota sem precisar copiar/
   colar nada manualmente (ver `client/src/device-auth.ts`).

Respostas: `200 {"ok": true}` em sucesso; `400 {"ok": false}` se
`accessToken` ausente ou corpo não for JSON válido.

Histórico: este endpoint nasceu (2026-09-09) pra sincronizar painel→CLI;
foi estendido (2026-09-16) pra também resolver o loop do `install.sh`
(pedia `BACKEND_V2_API_TOKEN` só gerável logando num painel que só existe
depois do próprio install). Com o painel desabilitado, o único emissor
hoje é a própria CLI (`cli/chat.ts#notifyLocalDaemon`, chamado logo após
login bem-sucedido) — mas o endpoint continua genérico, qualquer processo
nesta máquina pode chamá-lo.

## `GET /ws` (WebSocket)

Sem auth própria (mesma superfície de risco do resto deste servidor — só
seguro por estar atrás da VPN). Ao conectar, o servidor manda IMEDIATAMENTE
o estado atual completo; depois disso, manda de novo A CADA MUDANÇA
(nunca por polling — `panel/status-bus.ts` é pub-sub em memória). Mensagem
= `JSON.stringify(ClientState)` inteiro toda vez, nunca um diff.

```ts
interface ClientState {
    whatsapp: {
        status: "disconnected" | "connecting" | "qr" | "connected" | "error";
        qrDataUrl?: string;  // imagem PNG em data-URL — não usado pela CLI
        qrText?: string;     // payload de TEXTO bruto do QR (2026-09-17) — a CLI desenha isto em ASCII via `qrcode-terminal`
        error?: string;      // OBSERVAÇÃO: não é limpo em toda transição — só é confiável quando status === "error" (ver client/src/cli/ink/channels-screen.ts)
    };
    telegram: { status: ...; error?: string };
    machineAgent: { status: ...; machineName?: string; error?: string };
}
```

Consumidores hoje: `client/src/cli/ink/channels-screen.ts` (tela `/canais`
da CLI, só leitura). O painel (quando reativado) consumia o mesmo shape
pra mostrar o QR como imagem no navegador.

## Retomando o painel web depois

O código Angular está intacto em `panel-app/`. Pra voltar a servir:

1. `npm run build:panel` (builda em `panel-app/dist/panel-app/browser/`).
2. Em `src/panel/server.ts`, reverter o handler default de
   `startPanelServer` pra servir os arquivos estáticos de lá + o
   fallback de SPA via `renderPanelPage` (`src/panel/page.ts`, que
   continua funcionando sem alteração nenhuma) — ver `git log` deste
   arquivo por volta de 2026-09-17 pro diff exato que foi revertido.
3. Em `install.sh`, adicionar de volta o passo de build (mesmo `git log`).

A API do backend-v2 que o painel consumia está documentada em
`backend-v2/docs/rest-api-reference.md` — nada nela mudou por causa
desta desativação, só o cliente (painel) que parou de ser servido.
