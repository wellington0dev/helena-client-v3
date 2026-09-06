#!/usr/bin/env node
// FERRAMENTA DE DESENVOLVIMENTO — não faz parte do client/ de produção,
// não é instalada por install.sh/install.ps1, não é mencionada pro
// usuário final. Serve só pra testar se o MODELO escolhe o comando certo
// pra cada sistema operacional (ex: `Get-ChildItem` no Windows vs `ls` no
// Linux/macOS), sem precisar de uma máquina real daquele SO.
//
// Registra no backend-v2 como um "helena agent" de verdade, mas NUNCA
// executa o comando recebido — só ecoa de volta o que teria rodado. Isso
// isola a pergunta "o modelo pediu o comando certo?" da pergunta "esse
// comando roda de verdade nesse SO?" (a segunda só um Windows/macOS real
// responde).
//
// Uso:
//   BACKEND_V2_URL=http://localhost:4001 BACKEND_V2_API_TOKEN=<token de teste> \
//     node scripts/dev-fake-os-agent.js <machineName> <win32|linux|darwin>

const [, , machineName, platform] = process.argv;
const VALID_PLATFORMS = new Set(["win32", "linux", "darwin"]);

if (!machineName || !VALID_PLATFORMS.has(platform)) {
    console.error("Uso: node scripts/dev-fake-os-agent.js <machineName> <win32|linux|darwin>");
    process.exit(1);
}

const backendUrl = process.env.BACKEND_V2_URL || "";
const apiToken = process.env.BACKEND_V2_API_TOKEN || "";
if (!backendUrl || !apiToken) {
    console.error("BACKEND_V2_URL/BACKEND_V2_API_TOKEN precisam estar no ambiente (use um token de TESTE, nunca o de produção).");
    process.exit(1);
}

const backendWsUrl = backendUrl.replace(/^http/, "ws");
const socket = new WebSocket(`${backendWsUrl}/ws/agent?token=${encodeURIComponent(apiToken)}`);

socket.addEventListener("open", () => {
    console.log(`[fake-os-agent] conectado como "${machineName}" fingindo platform="${platform}".`);
    socket.send(
        JSON.stringify({
            type: "register",
            protocolVersion: 1,
            machineName,
            capabilities: ["shell"],
            platform,
        }),
    );
});

socket.addEventListener("message", (event) => {
    let message;
    try {
        message = JSON.parse(String(event.data));
    } catch {
        return;
    }
    if (message.type !== "exec" || message.capability !== "shell") return;

    const { command, cwd } = message.payload;
    // Registro bem visível no terminal — é ISSO que você quer olhar: o
    // comando exato que o modelo decidiu mandar pra esta plataforma.
    console.log(`\n[${platform}] comando recebido: ${command}${cwd ? ` (cwd: ${cwd})` : ""}`);

    // Texto de sucesso "normal" de propósito (nada de "não executado de
    // verdade" aqui) — um mock que soa como falha faz o modelo repetir
    // essa falha na resposta, o que parece um bug real mas é só o texto
    // do stub confundindo a narração. O log no terminal (linha acima) já
    // é onde você vê o comando de verdade, sem precisar disso no stdout.
    const result = {
        stdout: `(ambiente de teste — comando não roda de verdade) ${command}`,
        stderr: "",
        code: 0,
    };
    socket.send(JSON.stringify({ type: "exec-result", requestId: message.requestId, ok: true, result }));
});

socket.addEventListener("close", () => {
    console.log(`[fake-os-agent] "${machineName}" desconectado.`);
    process.exit(0);
});

socket.addEventListener("error", (event) => {
    console.error("[fake-os-agent] erro de conexão:", event.message ?? event);
});
