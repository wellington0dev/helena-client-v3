# API local do daemon (`/v1`)

O daemon (`src/main.ts`) é o hub local: a TUI (e qualquer outro processo desta máquina) fala **só** com ele; o
daemon guarda o JWT do usuário e o token de dispositivo e fala com o backend. Substitui o antigo servidor do painel
(`/health`, `/cli-session`, `/ws` sem autenticação em `0.0.0.0`). Plano e motivação: `docs/plano-evolucao-v3.md`
§4 (repositório `helena-ai-2.0`).

## Segurança
- **Bind `127.0.0.1`** por padrão (`CLIENT_LOCAL_BIND` para mudar — ex.: IP da VPN; continua exigindo token).
- **Token local** (`~/.config/helena/local-token`, `0600`, 32 bytes aleatórios, criado no 1º boot), comparado em
  tempo constante. HTTP: `Authorization: Bearer <token>`. WebSocket: subprotocolo `helena.bearer.<token>` (ou `?token=`).
- **Qualquer requisição com header `Origin` é recusada (403)**: bloqueia CSRF/DNS-rebinding vindos de navegador. Sem CORS.
- Só `GET /health` é público.
- Limite honesto: qualquer processo do **mesmo usuário do SO** lê o arquivo do token (mesmo nível do `session.json`).
- Porta: `CLIENT_LOCAL_PORT` (a antiga `CLIENT_PANEL_PORT` continua aceita por uma versão). Padrão 4100.

## Rotas (apiVersion 1)
| Rota | Descrição |
|---|---|
| `GET /health` | `{status, version, apiVersion, session:{loggedIn}}` (sem auth) |
| `GET /v1/session/status` | `{loggedIn}` — sem rede |
| `POST /v1/session/login` `{email,password}` · `POST /v1/session/register` | o daemon autentica no backend, guarda o JWT (`session.json` `0600`) e devolve **só `{user}`** |
| `POST /v1/session/logout` | apaga a sessão local |
| `GET /v1/session/me` | `GET /auth/me` do backend |
| `POST /v1/chat/messages` | `POST /chat/messages`; injeta `machineName` (hostname) se a TUI não mandar |
| `POST /v1/chat/sessions/:id/resolve`, `GET /v1/chat/sessions`, `GET /v1/chat/sessions/:id/history?limit&offset` | passagem 1:1 a `/chat/*` (query preservada) |
| `ANY /v1/backend/<prefixo>/*` | passagem autenticada; **allowlist**: `contacts`, `mcp-connections`, `billing`, `payments`, `dashboard`, `projects`, `agent-personas`, `telemetry`, `feedback`, `auth/me`, `auth/api-tokens`. Nunca repassa `Authorization`/`Cookie` do chamador; corpo ≤ 1 MB (413); rejeita `..`, `//`, `\` |
| `GET /v1/events` (WS) | ao conectar: `{type:"hello"}` e `{type:"state", data:{channels, session, backend…}}`; depois cada evento `{id, ts, type, data}`. `?since=<id>` reenvia o que foi perdido (`job_done`, `project_event`, `session.expired`) com `replayed:true` |
| `POST /cli-session` (**legado**) | CLI antigo entrega um JWT já obtido; agora exige o token local |
| `GET /ws` (**legado**) | estado dos canais no formato antigo; agora exige o token local |

### Eventos do hub
`state.channels` (WhatsApp/Telegram/máquina, inclui QR), `state.session`, `state.backend` (`ok|down|unauth`),
`chat.progress` (`turn_start`, `tool_call`, `turn_end`, `turn_error`, `job_done`, `project_event`, `project_step` —
vindos de **uma única** conexão `/ws/chat-progress`, com reconexão por backoff), `session.expired` (o backend
devolveu 401: a TUI pede login de novo sem perder a tela).

## Ainda não implementado (próximos passos do plano §4.8)
`/v1/channels` (ações), `/v1/machine`, `/v1/config` (config central), `/v1/doctor`, refresh token (R0b), `helena local-token rotate`,
inventário final da allowlist, migração de `.whatsapp-auth`/`.env`.

## Testes
`node --test src/local-api/local-api.test.ts` (16 testes: bind, auth, Origin, login sem vazar JWT, passagem sem repassar
credencial do chamador, allowlist/traversal, injeção de `machineName`, 413, 401→`session.expired`, WS com/sem token,
replay, legado, token 0600/rotação, upstream com reconexão).
