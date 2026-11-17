import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pairDeviceAfterLogin } from "./device-pairing.ts";
import { loadDeviceIdentity } from "./device-identity.ts";

test("visual approval keeps possession proof on Client and activates then returns for WS reconnection", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "helena-pairing-"));
    const previousConfigDir = process.env.HELENA_CONFIG_DIR;
    process.env.HELENA_CONFIG_DIR = directory;
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    let reads = 0;
    const fetcher = (async (pathValue: string, init?: RequestInit) => {
        calls.push({ path: pathValue, init });
        if (pathValue.endsWith("/pairing-status")) {
            reads++;
            if (reads === 1) return new Response("{}", { status: 404 });
            if (reads === 2) return Response.json({ status: "pending" });
            if (reads === 3) return Response.json({ status: "approved" });
            return Response.json({ status: "active" });
        }
        if (pathValue === "/machines/devices/pairing-requests") {
            return Response.json({ possessionSecret: Buffer.alloc(32, 3).toString("base64url") });
        }
        if (pathValue.endsWith("/activate")) return Response.json({ active: true });
        return new Response("not found", { status: 404 });
    }) as typeof fetch;
    try {
        const result = await pairDeviceAfterLogin({
            backendUrl: "https://api.example.test",
            fetch: fetcher,
            wait: async () => undefined,
        });
        const identity = loadDeviceIdentity();
        assert.equal(result, "paired");
        assert.match(identity?.credential ?? "", /^hdev1_[A-Za-z0-9_-]{43}$/);
        assert.equal(identity?.possessionSecret, undefined);
        const activation = calls.find((call) => call.path.endsWith("/activate"));
        const activationBody = JSON.parse(String(activation?.init?.body)) as { credential: string; possessionSecret: string };
        assert.equal(activationBody.credential, identity?.credential);
        assert.match(activationBody.possessionSecret, /^[A-Za-z0-9_-]{43}$/);
    } finally {
        if (previousConfigDir === undefined) delete process.env.HELENA_CONFIG_DIR;
        else process.env.HELENA_CONFIG_DIR = previousConfigDir;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
