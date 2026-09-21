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
| `GET /v1/channels` | estado dos canais (`whatsapp` com `qrText`, `telegram` com `tokenSet`, `machineAgent`) |
| `POST /v1/channels/whatsapp/{start,stop,logout}` · `POST /v1/channels/telegram/{start,stop}` | ações. `logout` do WhatsApp desvincula o aparelho e apaga o auth local (próximo `start` pede QR novo); `stop`/`start` preservam a sessão |
| `PUT /v1/channels/telegram/token` `{token}` · `DELETE …/token` | grava/remove o token do bot (validado, **write-only**: nunca ecoado) e reinicia o Telegram |
| `GET /v1/config` · `PATCH /v1/config` | config central (`~/.config/helena/config.json`, `0600`): `backendUrl`, `machineName`, `allowedDirs`, `deniedPaths`, `backgroundShellTimeoutMinutes`, `mediaMaxMb`, `telegramBotToken`. PATCH inválido → 422 com `errors` por chave e **nada é gravado**; `null` remove a chave; resposta traz `restartRequired`. Precedência: config.json > `.env` > padrão (o `.env` é importado uma vez) |
| `GET /v1/machine` | nome, hostname, plataforma e estado do `machine-agent` |
| `GET /v1/doctor` | diagnóstico: backend, sessão, token de dispositivo, canais, permissões dos segredos, bind — sem vazar segredo |
| `POST /v1/local-token/rotate` | rotaciona o token local (única rota que o devolve), derruba as conexões WS antigas. CLI: `helena local-token rotate` / `helena local-token path` |
| `POST /cli-session` (**legado**) | CLI antigo entrega um JWT já obtido; agora exige o token local |
| `GET /ws` (**legado**) | estado dos canais no formato antigo; agora exige o token local |

### Eventos do hub
`state.channels` (WhatsApp/Telegram/máquina, inclui QR), `state.session`, `state.backend` (`ok|down|unauth`),
`chat.progress` (`turn_start`, `tool_call`, `turn_end`, `turn_error`, `job_done`, `project_event`, `project_step` —
vindos de **uma única** conexão `/ws/chat-progress`, com reconexão por backoff), `session.expired` (o backend
devolveu 401: a TUI pede login de novo sem perder a tela).

## Política de arquivos (capabilities `read_file`/`list_files`/`search_files`/`write_file`)
Fecha o achado C1 da auditoria de 10/09. **Sempre negados**: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.config/gcloud`, a pasta
de config da Helena, o diretório de auth do WhatsApp, e por nome `.env*` (exceto `.env.example|sample|template`), `*.pem|*.key|*.p12|*.pfx`,
chaves SSH, `.netrc`, `creds.json`, `session.json`, `device-token.json`, `local-token`; mais `deniedPaths` do usuário. Se `allowedDirs`
não estiver vazio, só o que estiver dentro delas (links simbólicos são resolvidos, `../` não escapa). A listagem/busca não revela nem entra
no que é protegido.

## Permissões de segredos (achado C5)
No boot o daemon põe `0600`/`0700` em `~/.config/helena`, `.env`, `.whatsapp-auth/` e `.whatsapp-lid-pins.json`; `install.sh`/`update.sh` também.

## Sessão e refresh token
O daemon guarda o access JWT e o **refresh token** (rotativo; backend `POST /auth/refresh`, branch `feat/auth-refresh-and-hardening` do `helena-bk-v3`). A TUI nunca vê nenhum dos dois. Renovação **preventiva** (faltando < 60 s pro access expirar) e **reativa** (401 → uma repetição), **single-flight** (refresh é de uso único: duas renovações paralelas derrubariam a sessão), com o par novo **gravado em disco antes de ser usado** (`session.json` atômico, `0600`). Refresh rejeitado (401/400) → sessão limpa + `session.expired`; falha de rede/5xx **não** desloga. Sessão legada (JWT sem refresh) segue expirando no 401. O login manda `deviceLabel` (nome da máquina) para `GET /auth/sessions`. Compatível com backend antigo (sem `refreshToken`, tudo funciona como antes).

## Ainda não implementado (próximos passos do plano §4.8)
 migração do `.whatsapp-auth` para `~/.local/share/helena`, inventário final da allowlist,
buffer de eventos persistente entre reinícios.

## Testes
`node --test src/local-api/` (28 testes. Base: bind, auth, Origin, login sem vazar JWT, passagem sem repassar
credencial do chamador, allowlist/traversal, injeção de `machineName`, 413, 401→`session.expired`, WS com/sem token,
replay, legado, token 0600/rotação, upstream com reconexão).

## Painel web removido
O painel Angular (`panel-app/`) foi removido deste repositório; o último commit que o contém está na tag **`panel-final`**
(`git checkout panel-final`). A interface passa a ser a TUI, falando só com esta API local.

Lacunas que o painel cobria e a TUI atual **não** cobre (a decisão do plano §5.3 é implementá-las na TUI nova, TUI-3):
- **identidade de dono** (`PATCH /auth/me/owner-identity`, via `/v1/backend/auth/me/owner-identity`);
- **anexar arquivo/imagem no chat** (`fileId`);
- **acesso pelo celular/navegador** — substituído por WhatsApp/Telegram e, opcionalmente, TUI remota (`CLIENT_LOCAL_BIND` + token local, ou SSH).
