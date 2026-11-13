import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverMcpServers, resolveStdioServer } from "./mcp-discovery.ts";

test("descobre configurações locais sem enviar comandos nem segredos", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "helena-mcp-"));
    try {
        await mkdir(path.join(home, ".cursor"));
        await writeFile(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {
            "Local serviço": { command: "node", args: ["server.js"], env: { SECRET: "secret-value" } },
            remote: { url: "http://localhost:3333/mcp" },
            secret: { url: "https://example.com/mcp?token=secret" },
            headers: { url: "https://example.com/mcp", headers: { Authorization: "secret" } },
        } }));
        const results = await discoverMcpServers(home, "linux");
        assert.equal(results.length, 2);
        assert.equal(JSON.stringify(results).includes("secret"), false);
        const local = results.find((item) => item.transport === "stdio")!;
        assert.equal(local.serverUrl, "stdio://cursor/Local%20servi%C3%A7o");
        assert.deepEqual(await resolveStdioServer(local.serverUrl, home, "linux"), { command: "node", args: ["server.js"], env: { SECRET: "secret-value" }, cwd: undefined });
        await assert.rejects(resolveStdioServer("stdio://cursor/__proto__", home, "linux"));
        await assert.rejects(resolveStdioServer("stdio://unknown/test", home, "linux"));
    } finally { await rm(home, { recursive: true, force: true }); }
});
