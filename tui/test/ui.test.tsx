import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../src/ui/App.tsx";
import { LocalApiError, type LocalApi } from "../src/api/client.ts";
import type { HistoryPage, HubEvent, SendMessageResult } from "../src/api/types.ts";
import type { Connect } from "../src/ui/App.tsx";

const PAGE_UP = String.fromCharCode(27) + "[5~"; // sequência real do PageUp (o KeyCodes do mock não tem PAGE_UP)
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

interface Fake {
    api: LocalApi;
    calls: Array<{ fn: string; args: unknown[] }>;
    emit: (e: HubEvent) => void;
    connect: Connect;
    setLoggedIn(v: boolean): void;
    replies: SendMessageResult[];
    history: (limit: number, offset: number) => HistoryPage;
}

function makeFake(opts: { loggedIn?: boolean; health?: () => Promise<never> } = {}): Fake {
    const calls: Fake["calls"] = [];
    let loggedIn = opts.loggedIn ?? true;
    let onEvent: (e: HubEvent) => void = () => {};
    const f: Fake = {
        calls,
        replies: [],
        history: (limit, offset) => ({ entries: [], total: 0, limit, offset }),
        emit: (e) => onEvent(e),
        setLoggedIn: (v) => void (loggedIn = v),
        connect: ((o: { onEvent: (e: HubEvent) => void; onStatus?: (s: "connecting" | "open" | "closed") => void }) => {
            onEvent = o.onEvent;
            o.onStatus?.("open");
            setTimeout(() => o.onEvent({ type: "state", data: { channels: { whatsapp: { status: "connected" }, telegram: { status: "disconnected" }, machineAgent: { status: "connected" } }, backend: "ok" } }), 5);
            return { close() {} };
        }) as Connect,
        api: undefined as never,
    };
    const rec = <T,>(fn: string, value: () => T) => (...args: unknown[]) => {
        calls.push({ fn, args });
        return Promise.resolve(value());
    };
    f.api = {
        baseUrl: "http://x", token: "t",
        health: opts.health ?? rec("health", () => ({ status: "ok", version: "t", apiVersion: 1, session: { loggedIn } })),
        sessionStatus: () => Promise.resolve({ loggedIn }),
        login: rec("login", () => { loggedIn = true; return { user: { id: "u", email: "a@b.c" } }; }),
        logout: rec("logout", () => { loggedIn = false; }),
        sendMessage: rec("sendMessage", () => f.replies.shift() ?? { sessionId: "s1", text: "ok" }),
        resolve: rec("resolve", () => f.replies.shift() ?? { sessionId: "s1", text: "feito" }),
        sessions: rec("sessions", () => [{ id: "s-longa", title: "Conversa longa", updatedAt: "2026-09-21T10:00:00Z" }]),
        history: ((sid: string, limit: number, offset: number) => { calls.push({ fn: "history", args: [sid, limit, offset] }); return Promise.resolve(f.history(limit, offset)); }) as LocalApi["history"],
        channels: rec("channels", () => ({ whatsapp: { status: "connected" }, telegram: { status: "disconnected" }, machineAgent: { status: "connected" } })),
        doctor: rec("doctor", () => ({ ok: false, version: "t", checks: [{ name: "backend", status: "ok", detail: "respondeu 200" }, { name: "WhatsApp", status: "fail", detail: "error" }] })),
        backend: rec("backend", () => ({})),
        channelAction: rec("channelAction", () => undefined),
    } as LocalApi;
    return f;
}

async function mount(f: Fake, size = { width: 100, height: 34 }) {
    const t = await testRender(<App api={f.api} connect={f.connect} onExit={() => {}} />, size);
    await t.renderOnce();
    await tick(80);
    await t.renderOnce();
    return t;
}
const frame = async (t: Awaited<ReturnType<typeof mount>>, needle: string, timeout = 3000) => {
    try {
        return await t.waitForFrame((fr) => fr.includes(needle), { timeout });
    } catch (e) {
        // no timeout, mostra a tela de verdade — falha sem contexto custa caro de depurar
        console.log(`--- esperando "${needle}"; tela atual ---\n${t.captureCharFrame().split("\n").filter((l) => l.trim()).join("\n")}`);
        throw e;
    }
};
const tab = async (t: Awaited<ReturnType<typeof mount>>) => {
    await t.mockInput.pressTab();
    await t.flush();
    await tick(60); // o foco só muda depois do render seguinte
    await t.renderOnce();
};
const type = async (t: Awaited<ReturnType<typeof mount>>, text: string) => {
    await t.mockInput.typeText(text);
    await t.flush();
    await tick(40);
    await t.renderOnce();
};
const enter = async (t: Awaited<ReturnType<typeof mount>>) => {
    await t.mockInput.pressEnter();
    await t.flush();
    await tick(80);
    await t.renderOnce();
};

describe("TUI (telas em memória)", () => {
    test("daemon fora do ar → tela de erro com instrução (sem travar)", async () => {
        const f = makeFake({ health: () => Promise.reject(new LocalApiError(0, "daemon_unreachable", "Daemon local não respondeu")) });
        const t = await mount(f);
        expect(await frame(t, "Daemon local não respondeu")).toContain("O daemon está rodando?");
    });

    test("sem sessão: login (e-mail → Tab → senha mascarada → Enter) chama o daemon e abre o chat", async () => {
        const f = makeFake({ loggedIn: false });
        const t = await mount(f);
        expect(await frame(t, "Helena — entrar")).toContain("e-mail");
        await type(t, "ana@exemplo.com");
        await tab(t);
        await type(t, "segredo123");
        const masked = t.captureCharFrame();
        expect(masked).toContain("••••••••••");
        expect(masked).not.toContain("segredo123");
        await enter(t);
        const login = f.calls.find((c) => c.fn === "login")!;
        expect(login.args).toEqual(["ana@exemplo.com", "segredo123"]);
        expect(await frame(t, "mensagem")).toContain("● daemon");
    });

    test("conversa: envia, mostra tool + resposta + uso, e a barra de status reflete o hub", async () => {
        const f = makeFake();
        f.replies.push({ sessionId: "s1", text: "Rodei o comando.", toolActivity: [{ name: "shell", input: { command: "ls -la" }, output: "total 0" }], usage: { inputTokens: 120, outputTokens: 30, cachedTokens: 80, durationMs: 1200 } });
        const t = await mount(f);
        await type(t, "roda ls");
        await enter(t);
        const fr = await frame(t, "Rodei o comando.");
        expect(fr).toContain("› roda ls");
        expect(fr).toContain("● Bash(ls -la)");
        expect(fr).toContain("120 in · 30 out · 80 em cache · 1.2 s");
        expect(fr).toContain("● WhatsApp");
        expect(f.calls.find((c) => c.fn === "sendMessage")!.args).toEqual(["roda ls", undefined]);
    });

    test("confirmação de tool: mostra o cartão, 'a' aprova e a resposta final aparece", async () => {
        const f = makeFake();
        f.replies.push({ sessionId: "s1", text: "", pending: [{ tool: "shell", ref: "r1", input: { command: "rm -rf build" } }] });
        f.replies.push({ sessionId: "s1", text: "Apaguei a pasta build." });
        const t = await mount(f);
        await type(t, "limpa o build");
        await enter(t);
        const card = await frame(t, "confirmação necessária");
        expect(card).toContain("shell: rm -rf build");
        expect(card).toContain("[a] aprovar");
        await t.mockInput.pressKey("a");
        await t.flush();
        await tick(80);
        await t.renderOnce();
        expect(await frame(t, "Apaguei a pasta build.")).not.toContain("confirmação necessária");
        expect(f.calls.find((c) => c.fn === "resolve")!.args).toEqual(["s1", "shell", "r1", true]);
    });

    test("recusar ('r') manda approved=false", async () => {
        const f = makeFake();
        f.replies.push({ sessionId: "s1", text: "", pending: [{ tool: "shell", ref: "r2", input: { command: "git push --force" } }] });
        const t = await mount(f);
        await type(t, "força o push");
        await enter(t);
        await frame(t, "confirmação necessária");
        await t.mockInput.pressKey("r");
        await t.flush();
        await tick(60);
        expect(f.calls.find((c) => c.fn === "resolve")!.args[3]).toBe(false);
    });

    test("session.expired abre o login SEM perder a conversa; ao entrar de novo o histórico continua lá", async () => {
        const f = makeFake();
        f.replies.push({ sessionId: "s1", text: "Primeira resposta." });
        const t = await mount(f);
        await type(t, "oi");
        await enter(t);
        await frame(t, "Primeira resposta.");
        f.setLoggedIn(false);
        f.emit({ type: "session.expired", data: { reason: "backend_401" } });
        await t.flush();
        await tick(60);
        await t.renderOnce();
        expect(await frame(t, "Sua sessão expirou")).toContain("Helena — entrar");
        await type(t, "ana@exemplo.com");
        await tab(t);
        await type(t, "senha-nova");
        await enter(t);
        expect(await frame(t, "Primeira resposta.")).toContain("› oi");
    });

    test("/sessoes abre a lista, Enter carrega a janela mais recente; PageUp pede a página mais antiga (offset = mensagens já na janela)", async () => {
        const f = makeFake();
        f.history = (limit, offset) => ({ total: 250, limit, offset, entries: Array.from({ length: limit }, (_, i) => ({ id: `${offset}-${i}`, role: i % 2 ? "assistant" : "user", text: `linha ${offset + i}`, createdAt: "2026-09-21T10:00:00Z" })) });
        const t = await mount(f);
        await type(t, "/sessoes");
        await enter(t);
        expect(await frame(t, "Conversa longa")).toContain("conversas");
        await t.mockInput.pressEnter();
        await t.flush();
        await tick(120);
        await t.renderOnce();
        expect(f.calls.filter((c) => c.fn === "history")[0]!.args).toEqual(["s-longa", 100, 0]);
        expect(await frame(t, "linha 99")).toContain("linha 98"); // a janela mostra o FIM (o mais recente) da 1ª página
        // PageUp rola pra cima; ao chegar no TOPO e pedir de novo, busca a página mais antiga
        for (let i = 0; i < 14; i++) {
            await t.mockInput.pressKey(PAGE_UP as never);
            await t.flush();
            await tick(30);
            await t.renderOnce();
        }
        await tick(150);
        const hist = f.calls.filter((c) => c.fn === "history");
        expect(hist.length).toBeGreaterThanOrEqual(2);
        expect(hist[1]!.args).toEqual(["s-longa", 100, 100]);
    });

    test("/doctor mostra o diagnóstico; /nova limpa; comando desconhecido avisa", async () => {
        const f = makeFake();
        const t = await mount(f);
        await type(t, "/doctor");
        await enter(t);
        const d = await frame(t, "respondeu 200");
        expect(d).toContain("✖ WhatsApp: error");
        await type(t, "/xyz");
        await enter(t);
        expect(await frame(t, "Comando desconhecido: /xyz")).toContain("/ajuda");
        await type(t, "/nova");
        await enter(t);
        await tick(60);
        await t.renderOnce();
        expect(t.captureCharFrame()).not.toContain("respondeu 200");
    });

    test("eventos do hub viram avisos: job_done (inclusive 'enquanto você estava fora')", async () => {
        const f = makeFake();
        const t = await mount(f);
        f.emit({ type: "job_done", data: { ok: true, summary: "npm install terminou" }, replayed: true });
        await t.flush();
        await tick(60);
        await t.renderOnce();
        expect(await frame(t, "enquanto você estava fora")).toContain("npm install terminou");
    });
});
