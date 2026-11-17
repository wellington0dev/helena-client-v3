import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("device identity is stable, random, and stored with private permissions", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "helena-device-"));
    const previousConfigDir = process.env.HELENA_CONFIG_DIR;
    process.env.HELENA_CONFIG_DIR = directory;
    try {
        const { createDeviceIdentity, ensureDeviceCredential, loadDeviceIdentity, deviceIdentityPath } = await import("./device-identity.ts");
        const identity = createDeviceIdentity("https://api.example.test/path");
        assert.match(identity.deviceId, /^[0-9a-f-]{36}$/);
        assert.equal(identity.credential, undefined);
        assert.equal(identity.backendUrl, "https://api.example.test");
        assert.deepEqual(loadDeviceIdentity(), identity);
        const activated = ensureDeviceCredential(identity);
        assert.match(activated.credential ?? "", /^hdev1_[A-Za-z0-9_-]{43}$/);
        assert.deepEqual(loadDeviceIdentity(), activated);
        if (process.platform !== "win32") assert.equal(fs.statSync(deviceIdentityPath()).mode & 0o777, 0o600);
    } finally {
        if (previousConfigDir === undefined) delete process.env.HELENA_CONFIG_DIR;
        else process.env.HELENA_CONFIG_DIR = previousConfigDir;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
