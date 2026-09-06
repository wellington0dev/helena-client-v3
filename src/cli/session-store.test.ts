import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HOME isolado ANTES de importar o módulo — SESSION_PATH é calculado uma vez, no
// module-load, a partir de os.homedir(). Sem isolar antes do import, o teste
// escreveria no ~/.config/helena real da máquina rodando o teste.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "helena-session-test-"));
const originalHome = process.env.HOME;
process.env.HOME = fakeHome;

const { loadSession, saveSession, clearSession } = await import("./session-store.ts");

before(() => {
    process.env.HOME = fakeHome;
});

after(() => {
    process.env.HOME = originalHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
});

test("loadSession: sem arquivo nenhum ainda, devolve undefined (não lança)", () => {
    assert.equal(loadSession(), undefined);
});

test("saveSession + loadSession: round-trip simples", () => {
    saveSession("jwt-de-teste");
    assert.deepEqual(loadSession(), { accessToken: "jwt-de-teste" });
});

test("saveSession: grava o arquivo com permissão 0600 (token não deve ficar legível por outros usuários)", () => {
    saveSession("jwt-de-teste");
    const sessionPath = path.join(fakeHome, ".config", "helena", "session.json");
    const mode = fs.statSync(sessionPath).mode & 0o777;
    assert.equal(mode, 0o600);
});

test("clearSession: apaga o arquivo, loadSession volta a devolver undefined", () => {
    saveSession("jwt-de-teste");
    clearSession();
    assert.equal(loadSession(), undefined);
});

test("clearSession: chamar sem arquivo existente não lança", () => {
    clearSession();
    assert.doesNotThrow(() => clearSession());
});
