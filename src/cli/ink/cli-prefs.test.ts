import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadCliPrefs, saveCliPrefs } from "./cli-prefs.ts";

test("cli-prefs: ausente/corrompido → {}; salvar mescla, grava 0600 e ignora chaves inválidas", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cp-"));
    const file = path.join(dir, "sub", "cli-prefs.json");
    try {
        assert.deepEqual(loadCliPrefs(file), {});
        assert.deepEqual(saveCliPrefs({ sidebar: false }, file), { sidebar: false });
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.deepEqual(loadCliPrefs(file), { sidebar: false });
        assert.deepEqual(saveCliPrefs({ sidebar: true }, file), { sidebar: true });
        fs.writeFileSync(file, JSON.stringify({ sidebar: "sim", lixo: 1 }));
        assert.deepEqual(loadCliPrefs(file), {});
        fs.writeFileSync(file, "não é json");
        assert.deepEqual(loadCliPrefs(file), {});
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
