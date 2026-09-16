/**
 * Base HTTP compartilhada por todo módulo de API da CLI (`cli/backend.ts`
 * e os `cli/api/*.ts` de cada domínio — Contatos/MCP/Projetos/etc). Antes
 * vivia dentro de `backend.ts` sozinho; extraído aqui pra não duplicar em
 * cada novo domínio e pra concentrar a extração de mensagem de erro (ver
 * `extractMessage` abaixo).
 */

/** Distinta de um erro genérico pra quem chama saber quando vale a pena relogar em vez de só mostrar o erro. */
export class UnauthorizedError extends Error {}

/**
 * O Nest devolve corpo de erro `{message: string}` ou `{message:
 * string[]}` (ValidationPipe/class-validator, ex: "valor mínimo é
 * R$5,00") — antes isto era jogado cru dentro de uma frase
 * (`backend-v2 respondeu ${status}: ${body}`), escondendo a mensagem real
 * atrás do JSON inteiro. Extrai a mensagem de fato, com fallback pro
 * corpo cru se não for o formato esperado.
 */
async function extractMessage(response: Response): Promise<string> {
    const raw = await response.text().catch(() => "");
    try {
        const parsed = JSON.parse(raw) as { message?: string | string[] };
        if (typeof parsed.message === "string") return parsed.message;
        if (Array.isArray(parsed.message) && parsed.message.every((m) => typeof m === "string")) return parsed.message.join(" — ");
    } catch {
        // corpo não era JSON — cai no texto cru abaixo.
    }
    return raw || `HTTP ${response.status}`;
}

export async function parseOrThrow<T>(response: Response): Promise<T> {
    if (!response.ok) {
        const message = await extractMessage(response);
        if (response.status === 401) throw new UnauthorizedError(message);
        throw new Error(message);
    }
    return response.json() as Promise<T>;
}

/** Endpoints autenticados (JWT do login por email/senha) — mesmo protocolo REST que o painel fala. */
export async function authed<T>(baseUrl: string, token: string, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return parseOrThrow<T>(response);
}
