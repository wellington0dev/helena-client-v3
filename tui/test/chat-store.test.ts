import { describe, expect, test } from "bun:test";
import { chatReducer, hasOlder, heldMessages, initialChat, MAX_ITEMS, olderOffset, toolLabel, type ChatState } from "../src/state/chat-store.ts";
import type { HistoryPage } from "../src/api/types.ts";

const page = (n: number, total: number, offset = 0): HistoryPage => ({
    total, limit: n, offset,
    entries: Array.from({ length: n }, (_, i) => ({ id: `e${offset}-${i}`, role: i % 2 === 0 ? "user" : "assistant", text: `msg ${offset}-${i}`, createdAt: "2026-09-21T10:00:00Z" })),
});

describe("chat-store", () => {
    test("history_loaded troca a conversa; prepend acrescenta as antigas no topo sem duplicar a janela", () => {
        let s = chatReducer(initialChat, { type: "history_loaded", sessionId: "s1", page: page(20, 45) });
        expect(s.items).toHaveLength(20);
        expect(hasOlder(s)).toBe(true);
        expect(olderOffset(s)).toBe(20);
        s = chatReducer(s, { type: "history_loaded", sessionId: "s1", page: page(20, 45, 20), prepend: true });
        expect(s.items).toHaveLength(40);
        expect((s.items[0] as { text: string }).text).toBe("msg 20-0"); // as antigas vêm ANTES
        expect(olderOffset(s)).toBe(40);
        s = chatReducer(s, { type: "history_loaded", sessionId: "s1", page: page(5, 45, 40), prepend: true });
        expect(hasOlder(s)).toBe(false);
    });

    test("prepend de outra sessão é ignorado (não mistura conversas)", () => {
        const s = chatReducer(initialChat, { type: "history_loaded", sessionId: "s1", page: page(4, 4) });
        const t = chatReducer(s, { type: "history_loaded", sessionId: "OUTRA", page: page(4, 8, 4), prepend: true });
        expect(t.sessionId).toBe("OUTRA");
        expect(t.items).toHaveLength(4);
    });

    test("JANELA: nunca passa de MAX_ITEMS itens na tela, mesmo com centenas de mensagens novas", () => {
        let s: ChatState = chatReducer(initialChat, { type: "history_loaded", sessionId: "s", page: page(100, 100) });
        for (let i = 0; i < 500; i++) {
            s = chatReducer(s, { type: "user_sent", text: `u${i}` });
            s = chatReducer(s, { type: "turn_result", result: { sessionId: "s", text: `a${i}` } });
        }
        expect(s.items.length).toBeLessThanOrEqual(MAX_ITEMS);
        expect((s.items.at(-1) as { text: string }).text).toBe("a499"); // o que se mantém é o MAIS RECENTE
        expect(s.total).toBe(100 + 1000);
        expect(hasOlder(s)).toBe(true);
    });

    test("user_sent marca ocupado e limpa pendências; turn_result traz tools, texto, uso e pendências", () => {
        let s = chatReducer(initialChat, { type: "user_sent", text: "roda ls" });
        expect(s.busy).toBe(true);
        expect(s.live).toBe("pensando…");
        s = chatReducer(s, { type: "progress", event: { type: "tool_call", tool: "shell", input: { command: "ls -la" } } });
        expect(s.live).toBe("usando Bash(ls -la)");
        s = chatReducer(s, {
            type: "turn_result",
            result: { sessionId: "s9", text: "", pending: [{ tool: "shell", ref: "r1", input: { command: "rm x" } }], toolActivity: [{ name: "search_files", input: { path: "/tmp" }, output: [] }], usage: { inputTokens: 100, outputTokens: 20, cachedTokens: 60, durationMs: 1500 } },
        });
        expect(s.busy).toBe(false);
        expect(s.pending).toHaveLength(1);
        expect(s.sessionId).toBe("s9");
        expect(s.items.map((i) => i.kind)).toEqual(["user", "tool", "usage"]);
        expect((s.items.at(-1) as { text: string }).text).toBe("100 in · 20 out · 60 em cache · 1.5 s");
        s = chatReducer(s, { type: "user_sent", text: "depois" });
        expect(s.pending).toHaveLength(0);
    });

    test("erros e avisos viram itens de notice; turn_error para o indicador", () => {
        let s = chatReducer(initialChat, { type: "user_sent", text: "x" });
        s = chatReducer(s, { type: "progress", event: { type: "turn_error", message: "modelo indisponível" } });
        expect(s.live).toBeUndefined();
        expect(s.items.at(-1)).toMatchObject({ kind: "notice", tone: "error", text: "modelo indisponível" });
        s = chatReducer(s, { type: "error", message: "backend fora" });
        expect(s.busy).toBe(false);
    });

    test("toolLabel: rótulos compactos e fallback genérico", () => {
        expect(toolLabel("shell", { command: "ls -la" })).toBe("Bash(ls -la)");
        expect(toolLabel("read_file", { path: "/a/b.ts" })).toBe("Read(/a/b.ts)");
        expect(toolLabel("save_info", { topic: "café" })).toBe('save_info({"topic":"café"})');
        expect(toolLabel("save_info", undefined)).toBe("save_info");
        expect(toolLabel("shell", { command: "x".repeat(200) }).length).toBeLessThan(80);
    });

    test("reset limpa a conversa mas mantém o contador de ids (chaves React nunca se repetem)", () => {
        const s = chatReducer(chatReducer(initialChat, { type: "user_sent", text: "a" }), { type: "reset" });
        expect(s.items).toHaveLength(0);
        expect(s.nextId).toBeGreaterThan(1);
        expect(heldMessages(s)).toBe(0);
    });
});
