import assert from "node:assert/strict";
import test from "node:test";
import { measurePermissionDialog, permissionView } from "./permission-dialog.ts";

const shell = { tool: "shell", ref: "r1", input: { command: "npm run build", machine: "veronica", cwd: "/home/weber/app", background: true } };

test("permissionView: shell mostra o comando, o contexto e as 3 opções (só uma vez / sempre / não)", () => {
    const view = permissionView(shell);
    assert.equal(view.title, "Permissão necessária · Bash");
    assert.equal(view.primary, "$ npm run build");
    assert.equal(view.context, "veronica · em /home/weber/app · em segundo plano");
    assert.deepEqual(view.options.map((o) => o.decision), ["once", "always", "reject"]);
});

test("permissionView: outra tool NÃO oferece 'sempre permitir' (o backend só aprende shell)", () => {
    const view = permissionView({ tool: "write_file", input: { path: "a.txt" } });
    assert.deepEqual(view.options.map((o) => o.decision), ["once", "reject"]);
    assert.equal(view.title, "Permissão necessária · write_file");
    assert.match(view.primary, /"path": "a.txt"/);
    assert.equal(view.context, "");
});

test("permissionView: input malformado não lança e cai no modo genérico", () => {
    for (const input of [undefined, null, 42, "x", { command: 5 }]) {
        const view = permissionView({ tool: "shell", input });
        assert.deepEqual(view.options.map((o) => o.decision), ["once", "reject"]);
    }
});

test("measurePermissionDialog: conta borda + título + comando + contexto + pergunta + opções + dica", () => {
    // 2 bordas + título 1 + comando 1 + contexto 1 + branco 1 + pergunta 1 + 3 opções + dica 1 = 11 (largura folgada)
    assert.equal(measurePermissionDialog(shell, 200), 11);
    // sem contexto e sem 'sempre' (tool genérica de 1 linha de JSON): 2 + 1 + 1 + 1 + 1 + 2 + 1 = 9
    assert.equal(measurePermissionDialog({ tool: "x", input: 1 }, 200), 9);
});

test("measurePermissionDialog: comando longo quebra e aumenta a altura", () => {
    const long = { tool: "shell", input: { command: "echo " + "a".repeat(300) } };
    assert.ok(measurePermissionDialog(long, 60) > measurePermissionDialog(long, 400));
});
