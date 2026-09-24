import stringWidth from "string-width";
import { truncateToWidth } from "./worktree.ts";

/**
 * Linha de status do rodapé do chat. Sempre 1 linha: `main` (dim) à esquerda e `alert` (aviso, cor de
 * warning) à direita; se não couber, o `main` perde segmentos do fim pra frente e por último é truncado —
 * o alerta tem prioridade (é o que o dono precisa ver). Pura e testada em status-bar.test.ts.
 */
export interface StatusBarInfo {
    machine?: string;
    branch?: string;
    dir: string;
    sessionId?: string;
    /** Problemas ativos (ex: "WhatsApp desconectado", "máquina offline"). */
    alerts: string[];
}


export function statusBarParts(info: StatusBarInfo, width: number): { main: string; alert: string } {
    const alert = info.alerts.length > 0 ? `⚠ ${info.alerts.join(" · ")}` : "";
    const alertShown = alert ? truncateToWidth(alert, Math.max(1, width - 2)) : "";
    const room = alertShown ? width - stringWidth(alertShown) - 2 : width;

    // ordem = prioridade (o último é o primeiro a cair)
    const segments: string[] = [];
    if (info.machine) segments.push(info.machine);
    if (info.branch) segments.push(`⎇ ${info.branch}`);
    segments.push(info.dir);
    if (info.sessionId) segments.push(`sessão ${info.sessionId.slice(0, 8)}`);

    let kept = segments.length;
    let main = segments.join(" · ");
    while (kept > 1 && stringWidth(main) > room) {
        kept--;
        main = segments.slice(0, kept).join(" · ");
    }
    return { main: truncateToWidth(main, Math.max(0, room)), alert: alertShown };
}
