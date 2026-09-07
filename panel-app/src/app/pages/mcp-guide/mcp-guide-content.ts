/**
 * Conteúdo adaptado de backend-v2/docs/mcp-server-guide.md (+ intro de
 * mcp-plugins.md) pra quem vai ler isso DENTRO do painel, não no repo —
 * referências a outros arquivos .md viram explicação inline, e os
 * exemplos já vêm com a URL do backend e o token do próprio dono
 * preenchidos, prontos pra copiar e colar.
 */
export function buildMcpGuideMarkdown(backendUrl: string, jwt: string): string {
    const base = backendUrl || "https://sua-helena.exemplo.com";
    const token = jwt || "$JWT";

    return `
## O que é isso

Cada terceiro (uma loja, um CRM, um ERP) pode hospedar o **próprio servidor MCP** (Model Context Protocol) com as ferramentas e dados do negócio dele. Você cadastra a conexão (URL + token, se precisar) e a Helena passa a poder chamar essas ferramentas na conversa — sem que a Helena precise conhecer o seu negócio de antemão.

É o mecanismo de "plugin": um jeito de estender o que a Helena sabe fazer sem esperar uma atualização dela.

**Importante**: hoje o cadastro de uma conexão é só por API (chamadas abaixo) — ainda não tem um formulário aqui no painel. Isso está no roadmap.

## 1. O que a Helena espera do seu servidor

- **Transporte**: só **Streamable HTTP** remoto — um único endpoint HTTP (\`POST\`) que fala JSON-RPC 2.0, o protocolo MCP padrão. A Helena nunca roda um processo seu (\`stdio\`/\`command\`) — isso é bloqueado de propósito, por segurança.
- **Autenticação**: opcional. Se você cadastrar um \`authToken\` na conexão, toda requisição chega com \`Authorization: Bearer <seu-token>\`. Validar esse token é responsabilidade do SEU servidor — a Helena só repassa o valor exato que você digitou.
- **Velocidade**: a Helena dá **4 segundos** pra listar as tools do seu servidor (isso é chamado a cada mensagem de chat, então precisa ser rápido — considere cachear tools que não mudam) e **8 segundos** pra executar uma tool de verdade. Passar disso conta como "fora do ar" — a Helena avisa que a integração não respondeu, mas nunca trava por sua causa.
- **Nomes e descrições importam de verdade**: o \`name\` e a \`description\` de cada tool, e de cada parâmetro, vão direto pro que o modelo lê pra decidir se/como chamar sua ferramenta. Escreva como se estivesse explicando pra uma pessoa o que a tool faz e quando usar.

## 2. Exemplo mínimo funcional

Node.js + \`@modelcontextprotocol/sdk\` (a SDK oficial) + Express — sobe, lista produtos, detalha um produto.

\`\`\`bash
npm install @modelcontextprotocol/sdk express zod
\`\`\`

\`\`\`js
// server.js
import { randomUUID } from "node:crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const REQUIRED_TOKEN = process.env.MCP_AUTH_TOKEN; // combine com você mesmo o que vai colar em "authToken" ao cadastrar a conexão

const app = express();
app.use(express.json());

const products = [
    { id: "1", name: "Camiseta Azul", stock: 12 },
    { id: "2", name: "Tênis Preto", stock: 3 },
];

function buildServer() {
    const server = new McpServer({ name: "minha-loja-mcp", version: "1.0.0" });

    server.registerTool(
        "list_products",
        {
            description: "Lista os produtos da loja, opcionalmente filtrando por nome.",
            inputSchema: { query: z.string().optional().describe("Termo de busca no nome do produto") },
        },
        async ({ query }) => {
            const filtered = query ? products.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())) : products;
            return { content: [{ type: "text", text: JSON.stringify(filtered) }] };
        },
    );

    server.registerTool(
        "get_product",
        {
            description: "Detalhe (nome e estoque) de um produto específico pelo id.",
            inputSchema: { id: z.string().describe("Id do produto") },
        },
        async ({ id }) => {
            const product = products.find((p) => p.id === id);
            if (!product) return { content: [{ type: "text", text: \`Produto "\${id}" não encontrado.\` }], isError: true };
            return { content: [{ type: "text", text: JSON.stringify(product) }] };
        },
    );

    return server;
}

// Uma sessão MCP dura VÁRIAS requisições HTTP (initialize, depois cada
// chamada de tool é um POST separado) — precisa reusar o MESMO
// transport/server enquanto a sessão viver. Ver seção 3 abaixo pro que
// acontece se você errar isso.
const sessions = new Map();

app.post("/mcp", async (req, res) => {
    if (REQUIRED_TOKEN && req.headers.authorization !== \`Bearer \${REQUIRED_TOKEN}\`) {
        res.status(401).json({ error: "unauthorized" });
        return;
    }

    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId && sessions.get(sessionId);

    if (!transport) {
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => sessions.set(id, transport),
        });
        const server = buildServer();
        // Só limpa quando a sessão MCP É ENCERRADA DE VERDADE — nunca no
        // fim de cada resposta HTTP individual.
        transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
        };
        await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
});

app.listen(process.env.PORT || 3000, () => console.log("MCP server no ar"));
\`\`\`

## 3. Erro comum: sessão fechada cedo demais

**Sintoma**: \`initialize\` funciona (responde certinho), mas TODA chamada seguinte (\`notifications/initialized\`, \`tools/list\`, qualquer tool) devolve:

\`\`\`json
{"jsonrpc":"2.0","error":{"code":-32000,"message":"Bad Request: Server not initialized"},"id":null}
\`\`\`

**Causa real**: o protocolo MCP Streamable HTTP faz VÁRIAS requisições POST separadas dentro da mesma sessão lógica (\`initialize\`, depois cada chamada é outro POST com o header \`mcp-session-id\`). Se o seu código limpa o transport/server no evento \`res.on("close", ...)\` do Express, isso dispara ao fim de CADA requisição individual — inclusive a de \`initialize\`. Resultado: o mapa de sessões é populado e limpo na mesma respiração, e a próxima requisição sempre cria um transport novo (sem ter recebido \`initialize\`), daí o erro "not initialized".

**Fix**: nunca limpe no \`res.on("close")\`. Use \`transport.onclose\` (dispara só quando a sessão é encerrada de verdade) — é exatamente o que o exemplo acima já faz.

## 4. Testando o seu servidor sozinho (sem a Helena)

Handshake MCP mínimo via curl — três passos, sempre nessa ordem:

\`\`\`bash
# 1. initialize — pega o mcp-session-id da resposta (header)
curl -i -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"teste","version":"1.0"}}}'

# 2. notifications/initialized — usa o mcp-session-id do passo 1
curl -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "mcp-session-id: <SESSION_ID>" \\
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'

# 3. tools/list — confirma que suas tools aparecem, com schema certo
curl -X POST http://localhost:3000/mcp \\
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -H "mcp-session-id: <SESSION_ID>" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
\`\`\`

Se o passo 3 devolver suas tools com nome/descrição/schema certos, seu servidor está pronto pra conectar na Helena.

## 5. Registrando na Helena

Os comandos abaixo já vêm com a URL da sua Helena e o seu token de agora preenchidos — é só trocar \`name\`/\`serverUrl\`/\`authToken\` pelos do seu servidor.

\`\`\`bash
curl -X POST ${base}/mcp-connections \\
  -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" \\
  -d '{"name":"minha-loja","serverUrl":"https://seu-servidor.exemplo.com/mcp","authToken":"o-token-combinado-com-o-terceiro"}'
\`\`\`

\`authToken\` é opcional — omita se seu servidor não exige auth. Depois disso, na próxima mensagem que você mandar, \`minha-loja\` já aparece no catálogo que a Helena usa e ela pode chamar suas tools.

Pra editar (trocar URL/token, desativar) ou remover:

\`\`\`bash
curl -X PATCH ${base}/mcp-connections/<id> -H "Authorization: Bearer ${token}" -H "Content-Type: application/json" -d '{"enabled": false}'
curl -X DELETE ${base}/mcp-connections/<id> -H "Authorization: Bearer ${token}"
\`\`\`

Pra listar as conexões que você já cadastrou:

\`\`\`bash
curl ${base}/mcp-connections -H "Authorization: Bearer ${token}"
\`\`\`

${jwt ? "" : "> Faça login pra ver seu token preenchido automaticamente aqui.\n\n"}⚠️ Esse token é o mesmo usado nesta sessão do painel — vale por 24h desde o login. Não compartilhe com ninguém: quem tiver esse token consegue agir como você na Helena.

## 6. Checklist antes de conectar

- [ ] \`POST /mcp\` implementa o handshake completo (\`initialize\` → \`notifications/initialized\` → \`tools/list\`/\`tools/call\`) com sessão persistida corretamente (seção 3).
- [ ] Cada tool tem \`description\` clara e cada parâmetro do \`inputSchema\` também — é o que o modelo lê pra decidir usar.
- [ ] Responde em bem menos de 4s pra \`tools/list\` e de 8s pra qualquer \`tools/call\` — em produção, não só localhost.
- [ ] Se usa auth, valida o \`Authorization: Bearer <token>\` recebido de verdade (não confie só na Helena mandar o header certo).
- [ ] Testado com o handshake curl da seção 4 ANTES de tentar conectar na Helena — isola se o problema é no seu servidor ou na integração.

## Fora do escopo (por enquanto)

- Formulário no painel pra gerenciar conexões (só API por ora).
- Transporte \`stdio\`/processo local — decisão de segurança permanente, não só "ainda não implementado".
- A Helena hospedar o PRÓPRIO servidor MCP pra outros consumirem — hoje ela é só cliente.
`.trim();
}
