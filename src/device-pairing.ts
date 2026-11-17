import os from "node:os";
import { config } from "./config.ts";
import { createDeviceIdentity, ensureDeviceCredential, loadDeviceIdentity, saveDeviceIdentity } from "./device-identity.ts";

export type PairingFetch = (path: string, init?: RequestInit) => Promise<Response>;

export interface DevicePairingOptions {
    fetch: PairingFetch;
    backendUrl?: string;
    displayName?: string;
    signal?: AbortSignal;
    wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const PAIRING_POLL_MS = 2_500;
const abortError = () => new DOMException("Pareamento cancelado.", "AbortError");

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, milliseconds);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

async function json<T>(fetcher: PairingFetch, path: string, init?: RequestInit): Promise<T> {
    const response = await fetcher(path, init);
    if (!response.ok) throw new Error(`Falha no pareamento (${response.status}).`);
    return response.json() as Promise<T>;
}

/**
 * Creates or resumes the device's owner-scoped pairing request. The 256-bit
 * possession secret and generated credential stay on this Client; the browser
 * only receives the public device request and performs explicit approval.
 */
export async function pairDeviceAfterLogin(options: DevicePairingOptions): Promise<"paired" | "cancelled"> {
    const { fetch: fetcher, signal } = options;
    const backendUrl = options.backendUrl ?? config.backendUrl;
    const backendOrigin = new URL(backendUrl).origin;
    let identity = loadDeviceIdentity();
    if (identity && identity.backendUrl !== backendOrigin) {
        throw new Error("A identidade deste dispositivo pertence a outro servidor.");
    }
    if (!identity) identity = createDeviceIdentity(backendUrl);
    if (signal?.aborted) return "cancelled";

    const statusPath = () => `/machines/devices/${encodeURIComponent(identity!.deviceId)}/pairing-status`;
    let statusResponse = await fetcher(statusPath(), { signal });
    if (statusResponse.ok) {
        const current = await statusResponse.json() as { status: string };
        if (current.status === "active" && identity.credential) return "paired";
        if (current.status === "revoked" || current.status === "expired" || current.status === "rejected") {
            identity = createDeviceIdentity(backendUrl);
        }
    } else if (statusResponse.status !== 404) {
        throw new Error(`Não foi possível verificar o pareamento (${statusResponse.status}).`);
    } else if (identity.credential || identity.possessionSecret) {
        // A 404 on the authenticated owner-scoped route means this identity belongs to another account
        // (or was removed). Never reuse its credential/proof for this login.
        identity = createDeviceIdentity(backendUrl);
    }
    if (signal?.aborted) return "cancelled";

    if (!identity.possessionSecret && !identity.credential) {
        const request = await json<{ possessionSecret: string }>(fetcher, "/machines/devices/pairing-requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                deviceId: identity.deviceId,
                displayName: options.displayName ?? config.machineName ?? os.hostname(),
            }),
            signal,
        });
        identity = { ...identity, possessionSecret: request.possessionSecret };
        saveDeviceIdentity(identity);
    }

    while (!signal?.aborted) {
        statusResponse = await fetcher(statusPath(), { signal });
        if (statusResponse.status === 404) {
            // The record may have been revoked and its identity rotated above; a missing request is not approval.
            throw new Error("A solicitação de pareamento não está mais disponível.");
        }
        if (!statusResponse.ok) throw new Error(`Não foi possível consultar o pareamento (${statusResponse.status}).`);
        const status = await statusResponse.json() as { status: string };
        if (status.status === "active" && identity.credential) return "paired";
        if (status.status === "rejected" || status.status === "revoked" || status.status === "expired") {
            throw new Error("O pareamento foi recusado ou expirou. Faça login novamente para solicitar autorização.");
        }
        if (status.status === "approved") {
            if (!identity.possessionSecret) throw new Error("A prova de posse local não está disponível.");
            identity = ensureDeviceCredential(identity);
            await json(fetcher, `/machines/devices/${encodeURIComponent(identity.deviceId)}/activate`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credential: identity.credential, possessionSecret: identity.possessionSecret }),
                signal,
            });
            identity = { ...identity, possessionSecret: undefined };
            saveDeviceIdentity(identity);
            return "paired";
        }
        await (options.wait ?? wait)(PAIRING_POLL_MS, signal);
    }
    return "cancelled";
}
