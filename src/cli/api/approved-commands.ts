import { authed } from "./http.ts";

/**
 * Comandos shell que o dono marcou como "sempre permitir" (ver PermissionDialog) — espelha
 * `backend-v2/src/machines/approved-shell-commands.controller.ts`. String EXATA do comando; revogar aqui
 * faz a Helena voltar a pedir confirmação na próxima vez.
 */
export interface ApprovedCommand {
    id: string;
    command: string;
    createdAt: string;
}

export function listApprovedCommands(baseUrl: string, token: string): Promise<ApprovedCommand[]> {
    return authed(baseUrl, token, "GET", "/approved-shell-commands");
}

export function removeApprovedCommand(baseUrl: string, token: string, id: string): Promise<{ removed: boolean }> {
    return authed(baseUrl, token, "DELETE", `/approved-shell-commands/${encodeURIComponent(id)}`);
}
