import fs from "node:fs";
import type { EventHub } from "./event-hub.ts";
import { looseSecrets } from "./harden.ts";
import type { SessionManager } from "./session-manager.ts";

export interface DoctorCheck {
    name: string;
    status: "ok" | "warn" | "fail";
    detail: string;
}

export interface DoctorDeps {
    backendUrl: string;
    session: SessionManager;
    hub: EventHub;
    fetchImpl?: typeof fetch;
    deviceTokenPresent: boolean;
    /** Arquivos/diretórios com segredo (token local, session.json, .env, auth do WhatsApp…). */
    secretPaths: string[];
    listenHost: string;
    version: string;
}

/** Diagnóstico de uma passada: backend, credenciais, canais, permissões e bind. Nunca lança; nunca devolve segredo. */
export async function runDoctor(deps: DoctorDeps): Promise<{ ok: boolean; version: string; checks: DoctorCheck[] }> {
    const checks: DoctorCheck[] = [];
    const doFetch = deps.fetchImpl ?? fetch;

    if (!deps.backendUrl) {
        checks.push({ name: "backend", status: "fail", detail: "URL do backend não configurada (backendUrl)." });
    } else {
        try {
            const r = await doFetch(`${deps.backendUrl}/health`, { signal: AbortSignal.timeout(3000) });
            checks.push({ name: "backend", status: r.ok ? "ok" : "warn", detail: r.ok ? `respondeu ${r.status}` : `respondeu ${r.status}` });
        } catch (error) {
            checks.push({ name: "backend", status: "fail", detail: `inacessível: ${error instanceof Error ? error.message : String(error)}` });
        }
    }

    checks.push({ name: "sessão", status: deps.session.isLoggedIn() ? "ok" : "warn", detail: deps.session.isLoggedIn() ? "logado" : "sem sessão — faça login (a TUI pede)" });
    checks.push({ name: "token de dispositivo", status: deps.deviceTokenPresent ? "ok" : "warn", detail: deps.deviceTokenPresent ? "presente" : "ausente — WhatsApp/Telegram/execução remota ficam parados até o 1º login" });

    const channels = (deps.hub.snapshot().channels ?? {}) as { whatsapp?: { status?: string }; telegram?: { status?: string }; machineAgent?: { status?: string } };
    for (const [key, label] of [["whatsapp", "WhatsApp"], ["telegram", "Telegram"], ["machineAgent", "execução remota"]] as const) {
        const status = channels[key]?.status ?? "desconhecido";
        checks.push({ name: label, status: status === "connected" ? "ok" : status === "error" ? "fail" : "warn", detail: status });
    }

    const loose = looseSecrets(deps.secretPaths.filter((p) => fs.existsSync(p)));
    checks.push(loose.length === 0
        ? { name: "permissões", status: "ok", detail: "segredos legíveis só pelo dono" }
        : { name: "permissões", status: "warn", detail: `${loose.length} item(ns) com permissão frouxa (ex.: ${loose[0]}) — o daemon corrige no próximo boot` });

    const loopback = deps.listenHost === "127.0.0.1" || deps.listenHost === "::1";
    checks.push({ name: "bind da API local", status: loopback ? "ok" : "warn", detail: loopback ? "loopback" : `${deps.listenHost} (exposto fora do loopback — só o token local protege)` });

    return { ok: checks.every((c) => c.status !== "fail"), version: deps.version, checks };
}
