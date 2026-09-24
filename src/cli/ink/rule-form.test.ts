import { test } from "node:test";
import assert from "node:assert/strict";
import { formValuesToRule, ruleSummary, ruleToFormValues } from "./rule-form.ts";

const scope = { type: "channel" as const, channel: "whatsapp", label: "Todos do WhatsApp" };
const conns = [{ id: "c1", name: "Pedidos" }];

test("formulário completo → corpo da API (listas por vírgula, s/n, integração pelo NOME, dado proibido por nome amigável)", () => {
    const values = {
        ...ruleToFormValues(),
        name: "Clientes",
        task: "consultar pedido",
        condition: "o cliente pedir status",
        calCreate: "s",
        calPerDay: "2",
        machine: "veronica",
        readDirs: "/home/w/Pedidos, /home/w/Notas",
        readExts: "pdf, xlsx",
        deniedDirs: "/home/w/Pedidos/interno",
        mcpConnection: "pedidos",
        mcpTools: "consultar",
        presets: "CPF, cartão",
        terms: "preço de custo",
    };
    const { input, errors } = formValuesToRule(values, scope, conns);
    assert.deepEqual(errors, []);
    assert.equal(input!.scopeType, "channel");
    assert.deepEqual(input!.capabilities, {
        calendar: { create: true, checkAvailability: false, onlyIfFree: true, maxPerDay: 2 },
        files: [{ machine: "veronica", read: { dirs: ["/home/w/Pedidos", "/home/w/Notas"], extensions: ["pdf", "xlsx"] }, deniedDirs: ["/home/w/Pedidos/interno"] }],
        mcp: [{ connectionId: "c1", tools: ["consultar"] }],
    });
    assert.deepEqual(input!.disclosure, { presets: ["cpf", "cartao"], terms: ["preço de custo"], templates: [] });
});

test("erros claros: sem nome, pasta sem tipo, integração inexistente, dado desconhecido", () => {
    const { errors } = formValuesToRule({ ...ruleToFormValues(), readDirs: "/x", mcpConnection: "Nada", presets: "rg" }, scope, conns);
    assert.equal(errors.length, 5);
    assert.ok(errors.some((e) => /máquina/.test(e)));
    assert.ok(errors.some((e) => /tipos de leitura/.test(e)));
    assert.ok(errors.some((e) => /"Nada" não encontrada/.test(e)));
    assert.ok(errors.some((e) => /"rg" desconhecido/.test(e)));
});

test("ida e volta: regra → formulário → regra dá o mesmo", () => {
    const rule = formValuesToRule({ ...ruleToFormValues(), name: "R", notes: "s", presets: "email" }, scope, conns).input!;
    const again = formValuesToRule(ruleToFormValues({ ...rule, id: "x" }), scope, conns).input!;
    assert.deepEqual(again, rule);
    assert.equal(ruleSummary({ ...rule, id: "x" }), "deixa recado · protege 1 dado(s)");
});
