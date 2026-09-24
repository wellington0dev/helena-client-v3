import assert from "node:assert/strict";
import test from "node:test";
import type { CurrentUser } from "../backend.ts";
import { buildSettingItems, type SettingsTarget } from "./settings-modal.ts";

const me: CurrentUser = { id: "1", email: "a@b.c", role: "user", telemetryConsent: true, autoApproveShell: false, allowProactiveMessages: true, createdAt: "2026-01-01" };
const TARGETS: SettingsTarget[] = ["tokens", "permissions", "usage", "billing", "limits", "rules", "contacts", "mcp", "channels", "sessions", "telemetry-logs"];

test("buildSettingItems: ids únicos e seções agrupadas (cada seção contígua, na ordem)", () => {
    const items = buildSettingItems(me, true);
    assert.equal(new Set(items.map((i) => i.id)).size, items.length);
    const sections = items.map((i) => i.section);
    const collapsed = sections.filter((s, i) => s !== sections[i - 1]);
    assert.equal(new Set(collapsed).size, collapsed.length, "uma seção reaparece depois de outra — o cabeçalho duplicaria");
    assert.deepEqual(collapsed, ["Interface", "Segurança", "Privacidade", "Conta", "Integrações"]);
});

test("buildSettingItems: toggles da conta refletem o usuário; sem usuário (carregando) ficam SEM valor; sidebar é local e sempre tem valor", () => {
    const loaded = Object.fromEntries(buildSettingItems(me, false).map((i) => [i.id, i.value]));
    assert.deepEqual([loaded.sidebar, loaded["auto-shell"], loaded.telemetry, loaded.proactive], [false, false, true, true]);
    const loading = Object.fromEntries(buildSettingItems(undefined, true).map((i) => [i.id, i.value]));
    assert.deepEqual([loading.sidebar, loading["auto-shell"], loading.telemetry, loading.proactive], [true, undefined, undefined, undefined]);
});

test("buildSettingItems: todo link aponta para um destino que o app sabe abrir; todo toggle tem id conhecido", () => {
    for (const item of buildSettingItems(me, true)) {
        if (item.kind === "link") assert.ok(TARGETS.includes(item.id as SettingsTarget), `link "${item.id}" sem destino`);
        else assert.ok(["sidebar", "auto-shell", "telemetry", "proactive"].includes(item.id), `toggle "${item.id}" sem ação`);
        assert.ok(item.description.length > 0, `${item.id} sem descrição`);
    }
});
