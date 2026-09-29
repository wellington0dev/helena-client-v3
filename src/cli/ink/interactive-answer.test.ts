import { test } from "node:test";
import assert from "node:assert/strict";
import { historyItem, noticeItem } from "./history-item.ts";
import { composeFormAnswer, composeSelectAnswer, findLatestAnswerable } from "./interactive-answer.ts";
import type { FormItem } from "../../channels/markdown.ts";

test("findLatestAnswerable: null quando a última mensagem é do usuário", () => {
    const history = [historyItem("assistant", '<button>Ok</button>'), historyItem("user", "oi")];
    assert.equal(findLatestAnswerable(history), null);
});

test("findLatestAnswerable: null quando a última mensagem da Helena não tem bloco interativo", () => {
    const history = [historyItem("assistant", "texto normal, sem tag nenhuma")];
    assert.equal(findLatestAnswerable(history), null);
});

test("findLatestAnswerable: reconhece <select> de escolha única", () => {
    const history = [historyItem("assistant", '<select label="Qual?">\n<option>A</option>\n</select>')];
    const answerable = findLatestAnswerable(history);
    assert.equal(answerable?.kind, "select");
});

test("findLatestAnswerable: <select multiple=\"true\"> NÃO é respondível na v1 (sem widget multi-seleção)", () => {
    const history = [historyItem("assistant", '<select label="Quais?" multiple="true">\n<option>A</option>\n</select>')];
    assert.equal(findLatestAnswerable(history), null);
});

test("findLatestAnswerable: reconhece <button> avulso", () => {
    const history = [historyItem("assistant", "<button>Confirmar</button>")];
    assert.equal(findLatestAnswerable(history)?.kind, "button");
});

test("findLatestAnswerable: <form> com 1 botão e só inputs é respondível", () => {
    const history = [historyItem("assistant", '<form label="Cadastro">\n<input name="nome" label="Nome" />\n<button>Enviar</button>\n</form>')];
    assert.equal(findLatestAnswerable(history)?.kind, "form");
});

test("findLatestAnswerable: <form> com select aninhado NÃO é respondível na v1", () => {
    const history = [
        historyItem(
            "assistant",
            ['<form label="Cadastro">', '<select label="Prefere?">', "<option>A</option>", "</select>", "<button>Enviar</button>", "</form>"].join("\n"),
        ),
    ];
    assert.equal(findLatestAnswerable(history), null);
});

test("findLatestAnswerable: <form> com mais de um botão NÃO é respondível na v1 (Form só tem 1 submit)", () => {
    const history = [
        historyItem("assistant", ['<form label="Cadastro">', '<input name="nome" label="Nome" />', "<button>Salvar</button>", "<button>Cancelar</button>", "</form>"].join("\n")),
    ];
    assert.equal(findLatestAnswerable(history), null);
});

test("findLatestAnswerable: notice não conta como 'última mensagem da Helena'", () => {
    const history = [historyItem("assistant", "<button>Ok</button>"), noticeItem("máquina reconectada", "info")];
    assert.equal(findLatestAnswerable(history), null);
});

test("composeSelectAnswer: 'label: opção'", () => {
    assert.equal(composeSelectAnswer("Qual prato você quer?", "Pizza"), "Qual prato você quer?: Pizza");
});

test("composeFormAnswer: uma linha 'label: valor' por input, na ordem", () => {
    const items: FormItem[] = [
        { kind: "input", name: "nome", label: "Seu nome", inputType: "text" },
        { kind: "input", name: "idade", label: "Idade", inputType: "number" },
        { kind: "button", text: "Enviar" },
    ];
    const out = composeFormAnswer(items, { nome: "Maria", idade: "29" });
    assert.equal(out, "Seu nome: Maria\nIdade: 29");
});

test("composeFormAnswer: campo sem valor ainda gera a linha, vazia", () => {
    const items: FormItem[] = [{ kind: "input", name: "x", label: "X", inputType: "text" }];
    assert.equal(composeFormAnswer(items, {}), "X: ");
});
