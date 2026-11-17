import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { configDir } from "./local-api/paths.ts";

export interface DeviceIdentity {
    deviceId: string;
    credential?: string;
    possessionSecret?: string;
    backendUrl: string;
}

const IDENTITY_FILE = "device-identity.json";

export function deviceIdentityPath(): string {
    return path.join(configDir(), IDENTITY_FILE);
}

export function loadDeviceIdentity(): DeviceIdentity | undefined {
    try {
        const parsed = JSON.parse(fs.readFileSync(deviceIdentityPath(), "utf8")) as DeviceIdentity;
        if (
            typeof parsed.deviceId === "string"
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.deviceId)
            && (parsed.credential === undefined || (typeof parsed.credential === "string" && /^hdev1_[A-Za-z0-9_-]{43}$/.test(parsed.credential)))
            && (parsed.possessionSecret === undefined || (typeof parsed.possessionSecret === "string" && /^[A-Za-z0-9_-]{43}$/.test(parsed.possessionSecret)))
            && typeof parsed.backendUrl === "string"
        ) return parsed;
    } catch {
        // absent or unreadable identity: legacy connection is preserved.
    }
    return undefined;
}

export function createDeviceIdentity(backendUrl: string): DeviceIdentity {
    const backend = new URL(backendUrl);
    if (backend.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)) {
        throw new Error("Pareamento exige HTTPS (HTTP só é permitido em loopback).");
    }
    const identity: DeviceIdentity = {
        deviceId: crypto.randomUUID(),
        backendUrl: backend.origin,
    };
    saveDeviceIdentity(identity);
    return identity;
}

export function ensureDeviceCredential(identity: DeviceIdentity): DeviceIdentity {
    if (identity.credential) return identity;
    const updated = { ...identity, credential: `hdev1_${crypto.randomBytes(32).toString("base64url")}` };
    saveDeviceIdentity(updated);
    return updated;
}

export function saveDeviceIdentity(identity: DeviceIdentity): void {
    const file = deviceIdentityPath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(path.dirname(file), 0o700);
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(identity), { mode: 0o600 });
    if (process.platform !== "win32") fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") fs.chmodSync(file, 0o600);
}
