# Helena Desktop

O cliente principal da Helena é um aplicativo **Electron**. A interface é uma aplicação web renderizada pelo Chromium interno; ela não depende de abrir o navegador do sistema. O processo Electron inicia ou conecta ao backend local **Express**, que mantém os canais, a sessão, as integrações com o backend-v2 e as funções da máquina.

O renderer não recebe o JWT da conta nem o token local. Ele usa uma ponte IPC limitada no preload; chamadas autenticadas e os tokens ficam no processo principal. O backend local continua ligado a `127.0.0.1` por padrão.

## Desenvolvimento

```bash
npm install
npm start
```

`npm start` compila o backend desktop, abre o Vite em loopback e inicia o Electron. Para gerar os instaladores:

```bash
npm run desktop:package
```

O build embute o servidor central. Pode-se definir `HELENA_CENTRAL_URL` no ambiente de build; sem ela, usa `http://localhost:4510`, o padrão do `helena-bk-v3` em desenvolvimento. Quem usa o aplicativo não informa a URL.

Os artefatos são gerados em `release/`. O aplicativo usa `~/.config/helena` no Linux/macOS e `%APPDATA%\Helena` no Windows, preservando configurações, sessão, token local e autenticação do WhatsApp existentes.

O instalador recebe o endereço do servidor central durante o build (`HELENA_CENTRAL_URL` ou `BACKEND_V2_URL`); quem usa o aplicativo não precisa informar URL. O Express que controla este computador roda dentro do próprio Electron. Sem configuração de build, usa `http://localhost:4510`.

## O que roda no desktop

- Interface React no Chromium do Electron: conversa, canais, contatos, regras, integrações, créditos, uso e configurações.
- Backend Express local: API versionada, proxy autenticado ao backend-v2, configuração local e eventos WebSocket.
- Serviços de máquina: WhatsApp (Baileys), Telegram, execução remota, arquivos, MCP local, métricas e mensagens de saída.

## CLI legado

O código Ink e o comando `helena` permanecem no repositório para compatibilidade e migração. A interface principal e o fluxo de instalação passam a ser o aplicativo Electron; o CLI não é iniciado pelo Electron.

## Validação

```bash
npm run typecheck
npm run desktop:build
npm test
```

Não rode o daemon de desenvolvimento numa máquina que já tenha outro cliente Helena ativo sem antes confirmar qual processo está hospedando os canais. Apenas um processo deve controlar a sessão WhatsApp por vez.

## Documentação

- `docs/local-api.md`: API Express local, sessão, configuração e eventos.
- `src/cli/`: implementação Ink preservada durante a migração.
