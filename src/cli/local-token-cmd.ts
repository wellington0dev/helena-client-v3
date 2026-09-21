import { config } from "../config.ts";
import { localTokenPath, readLocalToken, rotateLocalToken } from "../local-api/local-token.ts";

/**
 * `helena local-token <rotate|path>` — gestão do token local da API do daemon.
 *  - `path`: mostra ONDE está o arquivo (nunca imprime o token).
 *  - `rotate`: se o daemon estiver no ar, pede a rotação a ele (troca o token em memória e derruba as conexões
 *    WS antigas); se não estiver, rotaciona só o arquivo (o daemon lê o novo no próximo boot).
 */
export async function runLocalTokenCommand(args: string[]): Promise<number> {
    const sub = args[0];
    if (sub === "path") {
        console.log(localTokenPath());
        return 0;
    }
    if (sub === "rotate") {
        const current = readLocalToken();
        if (current) {
            try {
                const response = await fetch(`http://127.0.0.1:${config.localPort}/v1/local-token/rotate`, { method: "POST", headers: { Authorization: `Bearer ${current}` }, signal: AbortSignal.timeout(3000) });
                if (response.ok) {
                    console.log("Token local rotacionado (daemon atualizado; conexões antigas foram fechadas).");
                    return 0;
                }
            } catch {
                // daemon não está no ar — rotaciona só o arquivo, abaixo.
            }
        }
        rotateLocalToken();
        console.log("Token local rotacionado no arquivo (o daemon não estava no ar; ele usará o novo token ao subir).");
        return 0;
    }
    console.error("Uso: helena local-token <rotate|path>");
    return 2;
}
