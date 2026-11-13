import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(here, "../dist-desktop/runtime-config.json");
const centralUrl = (process.env.HELENA_CENTRAL_URL || process.env.BACKEND_V2_URL || "http://localhost:4510").trim();

if (centralUrl) {
  let parsed;
  try { parsed = new URL(centralUrl); } catch { throw new Error("HELENA_CENTRAL_URL/BACKEND_V2_URL precisa ser uma URL absoluta."); }
  if (!(["http:", "https:"].includes(parsed.protocol))) throw new Error("HELENA_CENTRAL_URL/BACKEND_V2_URL precisa usar HTTP ou HTTPS.");
}

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ centralUrl }, null, 2), { mode: 0o600 });
