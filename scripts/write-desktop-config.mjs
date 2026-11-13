import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendConfig = JSON.parse(fs.readFileSync(path.join(here, "../src/backend-url.json"), "utf8"));
const centralUrl = String(backendConfig.url || "").trim();
let parsed;
try { parsed = new URL(centralUrl); } catch { throw new Error("src/backend-url.json precisa conter uma URL absoluta."); }
if (!("http:" === parsed.protocol || "https:" === parsed.protocol)) {
  throw new Error("src/backend-url.json precisa usar HTTP ou HTTPS.");
}

const output = path.resolve(here, "../dist-desktop/runtime-config.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ centralUrl }, null, 2), { mode: 0o600 });
