import { config } from "../config.ts";
import { createDeviceIdentity, ensureDeviceCredential, loadDeviceIdentity } from "../device-identity.ts";
import { createEventHub } from "../local-api/event-hub.ts";
import { createSessionManager } from "../local-api/session-manager.ts";
import { clearSession, loadSession, saveSession } from "./session-store.ts";

const [command, ...args] = process.argv.slice(2);
const backendUrl = config.backendUrl.replace(/\/$/, "");
const pairingPath = "/machines/devices/pairing-requests";
const session = createSessionManager({
    backendUrl,
    store: { load: loadSession, save: saveSession, clear: clearSession },
    hub: createEventHub(),
});

function usage(): never {
    throw new Error("Uso: helena device pair-request | helena device pair-complete | helena devices list | requests | approve <deviceId> <code> | reject <deviceId> | revoke <deviceId>");
}

async function api(method: string, endpoint: string, body?: unknown): Promise<unknown> {
    if (!backendUrl) throw new Error("URL do backend não configurada nesta instalação.");
    const response = await session.authedFetch(endpoint, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = text; }
    if (!response.ok) {
        const message = payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message: unknown }).message)
            : `HTTP ${response.status}`;
        throw new Error(message);
    }
    return payload;
}

try {
    if (command === "device" && args[0] === "pair-request") {
        if (!backendUrl) throw new Error("URL do backend não configurada nesta instalação.");
        let identity = loadDeviceIdentity();
        if (!identity) identity = createDeviceIdentity(backendUrl);
        if (identity.backendUrl !== new URL(backendUrl).origin) {
            throw new Error("A identidade local pertence a outro backend; não será sobrescrita automaticamente.");
        }
        const result = await api("POST", pairingPath, {
            deviceId: identity.deviceId,
            displayName: process.env.HELENA_DEVICE_NAME || process.env.COMPUTERNAME || process.env.HOSTNAME || "Helena Client",
        }) as { deviceId: string; pairingCode: string; possessionSecret: string; expiresAt: string };
        const { saveDeviceIdentity } = await import("../device-identity.ts");
        saveDeviceIdentity({ ...identity, possessionSecret: result.possessionSecret });
        console.log(`Solicitação criada para ${result.deviceId}.`);
        console.log(`Código temporário (10 min): ${result.pairingCode}`);
        console.log("Em contexto autenticado do proprietário, confira `helena devices requests` e aprove usando o código.");
        console.log("Depois da aprovação do proprietário, execute `helena device pair-complete` e reinicie o daemon.");
    } else if (command === "device" && args[0] === "pair-complete") {
        if (!backendUrl) throw new Error("URL do backend não configurada nesta instalação.");
        const identity = loadDeviceIdentity();
        if (!identity || identity.backendUrl !== new URL(backendUrl).origin) {
            throw new Error("Nenhum pedido de pareamento local corresponde ao backend configurado.");
        }
        if (!identity.possessionSecret) throw new Error("Segredo de posse ausente; solicite novo pareamento neste dispositivo.");
        const activated = ensureDeviceCredential(identity);
        await api("POST", `/machines/devices/${encodeURIComponent(activated.deviceId)}/activate`, { credential: activated.credential, possessionSecret: identity.possessionSecret });
        console.log(`Credencial do dispositivo ${activated.deviceId} ativada. Reinicie o daemon para usar o handshake pareado.`);
    } else if (command === "devices" && args[0] === "list") {
        console.log(JSON.stringify(await api("GET", "/machines/devices"), null, 2));
    } else if (command === "devices" && args[0] === "requests") {
        console.log(JSON.stringify(await api("GET", pairingPath), null, 2));
    } else if (command === "devices" && args[0] === "approve" && args[1] && args[2]) {
        await api("POST", `/machines/devices/${encodeURIComponent(args[1])}/approve`, { pairingCode: args[2] });
        console.log(`Dispositivo ${args[1]} aprovado.`);
    } else if (command === "devices" && args[0] === "reject" && args[1]) {
        await api("POST", `/machines/devices/${encodeURIComponent(args[1])}/reject`);
        console.log(`Solicitação ${args[1]} rejeitada.`);
    } else if (command === "devices" && args[0] === "revoke" && args[1]) {
        await api("DELETE", `/machines/devices/${encodeURIComponent(args[1])}`);
        console.log(`Dispositivo ${args[1]} revogado.`);
    } else {
        usage();
    }
} catch (error) {
    console.error(`[helena device] ${error instanceof Error ? error.message : "Falha inesperada."}`);
    process.exitCode = 1;
}
