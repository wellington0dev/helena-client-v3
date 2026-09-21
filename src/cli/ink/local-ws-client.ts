/**
 * Conecta no WS `/ws` do PRÓPRIO processo `client/` (`local-api/server.ts`)
 * rodando NESTA MESMA máquina — a CLI (`cli/`) é o mesmo pacote/npm do
 * daemon (`main.ts`), então pode falar `ws://localhost:${config.localPort}`
 * direto, sem passar pelo backend-v2. Nunca lança — se o daemon não
 * estiver rodando aqui (CLI usada remota, ou serviço ainda não
 * instalado), `onEvent` simplesmente nunca é chamado, mesmo espírito
 * gracioso de `notifyLocalDaemon` (`cli/chat.ts`).
 */
import { readLocalToken } from "../../local-api/local-token.ts";
import type { ClientState } from "../../local-api/status-bus.ts";

export function connectLocalWs(localPort: number, onState: (state: ClientState) => void): () => void {
    let closed = false;
    let socket: WebSocket | undefined;

    try {
        const token = readLocalToken();
        if (!token) return () => undefined; // daemon nunca subiu aqui: a tela mostra "não detectado"
        socket = new WebSocket(`ws://127.0.0.1:${localPort}/ws`, [`helena.bearer.${token}`]);
        socket.addEventListener("message", (event) => {
            try {
                onState(JSON.parse(event.data.toString()));
            } catch {
                // Payload malformado — ignora, nunca derruba a tela por isso.
            }
        });
        socket.addEventListener("error", () => socket?.close());
    } catch {
        // Sem daemon local nesta máquina — a tela mostra "não detectado".
    }

    return () => {
        if (closed) return;
        closed = true;
        socket?.close();
    };
}
