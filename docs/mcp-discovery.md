# Descoberta de servidores MCP locais

A página **Integrações MCP** consulta automaticamente os clientes conectados que anunciam `mcp_discover`. A lista também pode ser atualizada manualmente. Encontrar um servidor não o ativa: use **Adicionar**, revise nome e máquina e salve. Clientes antigos precisam ser atualizados e reconectados para oferecer a descoberta.

O cliente lê arquivos JSON locais nas seguintes localizações (`<config>` é `~/.config` no Linux, `~/Library/Application Support` no macOS e `~/AppData/Roaming` no Windows):

- `<config>/Claude/claude_desktop_config.json`
- `~/.cursor/mcp.json`
- `<config>/Code/User/mcp.json`
- `<config>/helena/mcp.json`

São aceitos os objetos `mcpServers` ou `servers`. Entradas com `command` são consideradas stdio; entradas com `url` HTTP(S) são consideradas HTTP. A descoberta lê configurações, não varre portas nem comprova que o servidor está funcionando. Arquivos ausentes ou JSON inválido são ignorados. Arquivos de projetos, outras aplicações, formatos JSON com comentários e configurações que precisem de expansão de variáveis não são descobertos automaticamente. Entradas HTTP com headers, credenciais ou parâmetros na URL são omitidas; configure-as manualmente com o token apropriado.

Exemplo de configuração local em `<config>/helena/mcp.json`:

```json
{"mcpServers":{"exemplo":{"command":"node","args":["/caminho/servidor.js"],"env":{"API_KEY":"valor-local"}}}}
```

Para stdio, a conexão salva contém apenas uma referência como `stdio://helena/exemplo` e a máquina de destino. O cliente relê a configuração quando precisa listar ou chamar ferramentas e executa o comando nessa máquina, sem shell, usando `args`, `cwd` e `env` da configuração e as variáveis padrão do transporte MCP. Comandos, argumentos e variáveis não são enviados na descoberta nem armazenados pelo backend; o arquivo local permanece a fonte de verdade. Não execute configurações de origem desconhecida: conectar inicia o processo definido no arquivo. Ao alterar ou remover a entrada local, a conexão passa a usar a nova configuração ou fica indisponível. O backend nunca executa processos stdio e exige uma máquina para essas referências. A descoberta não lê nem retorna tokens, mas resultados e dados de ferramentas seguem pelo canal normal entre cliente e backend.

## Contrato com web e mobile

O aplicativo consumidor usa `GET /machines` para encontrar máquinas online com a capacidade `mcp_discover` e faz `GET /mcp-connections/discover/:machine` com o JWT do usuário. O backend encaminha a solicitação pelo WebSocket do agente daquela máquina e retorna uma lista com `name`, `source`, `transport` e `serverUrl`. Assim, tanto web quanto mobile podem mostrar os resultados remotamente. A consulta é feita sob demanda, não é persistida, e exige que o cliente esteja conectado no momento da consulta. As conexões que o usuário salva são persistidas e continuam visíveis quando a máquina está offline; seu uso depende de a máquina voltar a ficar online.
