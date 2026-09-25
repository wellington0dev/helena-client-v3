# Helena — client (helena-client-v3)

O que roda no computador do dono. Dois programas no mesmo pacote:

- **Daemon** (`src/main.ts`, serviço `helena-client.service`): ponte do **WhatsApp** (Baileys) e do **Telegram**,
  execução remota na máquina (`src/machine-agent.ts`: shell, arquivos, MCP local), API local `/v1` no loopback
  (`docs/local-api.md`), entrega de mensagens agendadas, telemetria do próprio processo.
- **CLI `helena`** (`bin/helena.js` → `src/cli/`): chat em tela cheia feito com **Ink**, falando direto com o backend
  (`helena-bk-v3`).

## Instalação

```bash
./install.sh                    # npm install + serviço systemd de usuário (idempotente)
bash scripts/link-helena.sh     # comando global `helena`, sem sudo
```

Windows: `install.ps1` / `npm run service:install:windows`. Atualizar: `./update.sh`. Parar: `./stop.sh`.

`.env` (ver `.env.example`): `BACKEND_V2_URL`, `CLIENT_LOCAL_PORT`, `TELEGRAM_BOT_TOKEN`, `WHATSAPP_AUTH_DIR`,
`CLIENT_BACKGROUND_SHELL_TIMEOUT_MINUTES`. A máquina é vinculada à conta **pelo login** da CLI
(`~/.config/helena/device-token.json`); `BACKEND_V2_API_TOKEN` só existe como reserva de instalação antiga.

```bash
systemctl --user restart helena-client.service
journalctl --user -u helena-client.service -f
```

O daemon roda o código-fonte direto (`node --experimental-strip-types src/main.ts`), sem build. A CLI também: cada
`helena` aberto já usa o código atual do repositório.

## A CLI

Comandos (`/` abre a lista, Tab completa):

| Comando | O que faz |
|---|---|
| `/sessoes`, `/novo` | Retomar uma conversa / começar outra |
| `/sidebar` | Mostra/esconde a barra de sessões e gastos (clique pra retomar) |
| `/cobranca` | Créditos em R$: saldo, comprar mais, limite mensal padrão dos contatos |
| `/limites` | Limites de custo e passos (tuas mensagens, contatos, grupos, tarefas) + como a cotação funciona |
| `/regras` | Regras de atendimento: o que contatos/grupos podem fazer e dados que nunca saem; `a` = auditoria |
| `/contatos`, `/canais` | Contatos (limite mensal, permissões, `r` = regras) e status do WhatsApp/Telegram |
| `/integracoes` | Conexões MCP + guia de servidor compatível |
| `/permissoes` | Comandos "sempre permitidos" |
| `/uso`, `/telemetria` | Uso por canal; CPU/RAM da Helena por máquina e logs (logs só admin) |
| `/config`, `/logout`, `/help` | Preferências, sair da conta, ajuda |

Atalhos: **Ctrl+P** paleta · **Esc** ou **Ctrl+C** interrompe a resposta · **Ctrl+C** duas vezes (ou **Ctrl+D**) sai ·
**PageUp/PageDown** ou **roda do mouse** rolam o histórico · **@** menciona arquivo.

Enquanto a Helena responde, uma bolha dela aparece no fim da conversa: spinner com o que ela está fazendo, as últimas
linhas do raciocínio (em inglês, é o Google que gera) e, depois, o texto chegando em tempo real. A resposta final
substitui o rascunho. Cada mensagem manda um `turnId`; a CLI só aceita streaming do próprio turno.

A barra lateral mostra o bloco **Gastos**: saldo, custo da última mensagem, da sessão, do dia e o histórico por mensagem.

## Testes

```bash
npm test          # node --test src/**/*.test.ts
npm run typecheck
```

**Nunca teste contra o serviço de verdade**: esta máquina roda o `helena-client.service` real (WhatsApp/Telegram do
dono). Para a TUI use um HOME temporário (com `.config/helena/config.json` apontando pra um backend falso) e um pty.
Três cuidados que já deram falso "travou":

- `EIO` na leitura do pty é transitório, não fim do processo;
- defina o tamanho do terminal (`TIOCSWINSZ`) antes de iniciar;
- mande uma tecla por vez com pausa; rajada de uma vez só dá falso negativo no Ink.

## Documentação

- `docs/local-api.md`: API local `/v1` do daemon (token local, sessão, chat, eventos).
- Changelog (backend e client juntos): `docs/changelog.md` no `helena-bk-v3`.
- Referência da API do backend, incluindo os eventos de streaming: `docs/rest-api-reference.md` no `helena-bk-v3`.
