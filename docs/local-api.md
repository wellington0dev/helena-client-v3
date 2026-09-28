# API local do daemon (`/v1`)

O daemon (`src/main.ts`) roda como serviço em background na máquina do usuário, atuando como o hospedeiro local dos canais (WhatsApp e Telegram), executor de comandos de máquina (`machine-agent.ts`) e coletor de métricas do sistema.

A API local (`local-api/server.ts`) expõe o controle dos canais locais, telemetria da máquina e configurações de disco para a TUI (`helena`) e outras ferramentas locais. A TUI e os canais comunicam-se diretamente com o `backend-v2` para chat, autenticação e inteligência artificial.

## Segurança
- **Bind `127.0.0.1`** por padrão (`CLIENT_LOCAL_BIND` para mudar — ex.: IP da VPN; continua exigindo token).
- **Token local** (`~/.config/helena/local-token`, `0600`, 32 bytes aleatórios, criado no 1º boot), comparado em tempo constante. HTTP: `Authorization: Bearer <token>`. WebSocket: subprotocolo `helena.bearer.<token>` (ou `?token=`).
- **Qualquer requisição com header `Origin` é recusada (403)**: bloqueia CSRF/DNS-rebinding vindos de navegador. Sem CORS.
- Só `GET /health` é público.
- Limite honesto: qualquer processo do **mesmo usuário do SO** lê o arquivo do token (mesmo nível do `session.json`).
- Porta: `CLIENT_LOCAL_PORT` (padrão 4100).

## Rotas (apiVersion 1)
| Rota | Descrição |
|---|---|
| `GET /health` | `{status, version, apiVersion, session:{loggedIn}}` (sem auth) |
| `GET /v1/session/status` | `{loggedIn}` — estado da sessão local mantida no daemon |
| `POST /v1/session/logout` | apaga a sessão local no daemon |
| `GET /v1/channels` | estado dos canais (`whatsapp` com `qrText`, `telegram` com `tokenSet`, `machineAgent`) |
| `POST /v1/channels/whatsapp/{start,stop,logout}` | ações no WhatsApp local. `logout` desvincula o aparelho e apaga o auth local (próximo `start` pede QR novo); `stop`/`start` preservam a sessão |
| `POST /v1/channels/telegram/{start,stop}` | inicia ou interrompe o bot do Telegram local |
| `PUT /v1/channels/telegram/token` `{token}` · `DELETE …/token` | grava/remove o token do bot (validado, **write-only**: nunca ecoado) e reinicia o Telegram |
| `GET /v1/config` · `PATCH /v1/config` | config central (`~/.config/helena/config.json`, `0600`): `backendUrl`, `machineName`, `allowedDirs`, `deniedPaths`, `backgroundShellTimeoutMinutes`, `mediaMaxMb`, `telegramBotToken`. PATCH inválido → 422 com `errors` por chave e **nada é gravado**; `null` remove a chave; resposta traz `restartRequired` |
| `GET /v1/machine` | nome, hostname, plataforma e estado do `machine-agent` |
| `GET /v1/doctor` | diagnóstico: backend, sessão, token de dispositivo, canais, permissões dos segredos, bind — sem vazar segredo |
| `POST /v1/local-token/rotate` | rotaciona o token local (única rota que o devolve), derruba as conexões WS antigas. CLI: `helena local-token rotate` / `helena local-token path` |
| `POST /cli-session` | TUI entrega o JWT obtido no backend para o daemon sincronizar o token de dispositivo (`ensureDeviceToken`); exige token local |
| `GET /ws` | estado dos canais ao vivo (usado pela TUI para capturar QR Code); exige token local |
| `GET /v1/events` (WS) | eventos do hub local (`hello`, `state`, `chat.progress`); exige token local |

## Eventos do hub
`state.channels` (WhatsApp/Telegram/máquina, inclui QR), `state.session`, `state.backend` (`ok|down|unauth`), `chat.progress` (repassado do `/ws/chat-progress` do backend).

## Política de arquivos (capabilities `read_file`/`list_files`/`search_files`/`write_file`)
**Sempre negados**: `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.kube`, `~/.config/gcloud`, a pasta de config da Helena, o diretório de auth do WhatsApp, e por nome `.env*` (exceto `.env.example|sample|template`), `*.pem|*.key|*.p12|*.pfx`, chaves SSH, `.netrc`, `creds.json`, `session.json`, `device-token.json`, `local-token`; mais `deniedPaths` do usuário. Se `allowedDirs` não estiver vazio, só o que estiver dentro delas (links simbólicos são resolvidos, `../` não escapa).
