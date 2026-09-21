import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventHub } from "./event-hub.ts";
import { createSessionManager, type SessionStore } from "./session-manager.ts";

// JWT "de mentira" só com o payload (o daemon lê apenas `exp`; quem valida a assinatura é o backend).
const jwt = (expSecondsFromNow: number, tag: string) => `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow, tag })).toString("base64url")}.s`;

interface Backend {
    log: string[];
    valid: Set<string>; // access tokens aceitos em /probe
    refreshMode: "ok" | "401" | "500" | "network";
    refreshCalls: number;
    nextSeq: number;
    bodies: string[];
}

function makeBackend(): { fetchImpl: typeof fetch; b: Backend } {
    const b: Backend = { log: [], valid: new Set(), refreshMode: "ok", refreshCalls: 0, nextSeq: 1, bodies: [] };
    const fetchImpl = (async (url: string, init: RequestInit = {}) => {
        const path = new URL(url).pathname;
        const auth = new Headers(init.headers).get("authorization");
        b.log.push(`${init.method ?? "GET"} ${path}${auth ? ` [${auth.slice(7, 20)}]` : ""}`);
        if (init.body) b.bodies.push(String(init.body));
        const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        if (path === "/auth/login") {
            const access = jwt(3600, "login");
            b.valid.add(access);
            return json(201, { accessToken: access, refreshToken: "RT-0", expiresIn: 3600, user: { id: "u1" } });
        }
        if (path === "/auth/refresh") {
            b.refreshCalls++;
            if (b.refreshMode === "network") throw new Error("ECONNRESET");
            if (b.refreshMode === "401") return json(401, { message: "Sessão expirada" });
            if (b.refreshMode === "500") return json(503, { message: "indisponível" });
            await new Promise((r) => setTimeout(r, 30)); // dá tempo de chamadas concorrentes se acumularem
            const n = b.nextSeq++;
            const access = jwt(3600, `r${n}`);
            b.valid.add(access);
            return json(200, { accessToken: access, refreshToken: `RT-${n}`, expiresIn: 3600, user: { id: "u1" } });
        }
        if (path === "/auth/logout") return json(200, { ok: true });
        if (path === "/probe") return b.valid.has(auth?.slice(7) ?? "") ? json(200, { ok: true }) : json(401, { message: "expirado" });
        return json(404, {});
    }) as typeof fetch;
    return { fetchImpl, b };
}

function makeStore(initial?: { accessToken: string; refreshToken?: string }) {
    const saves: Array<{ access: string; refresh?: string }> = [];
    let cur = initial;
    const store: SessionStore = {
        load: () => cur,
        save: (access, refresh) => {
            saves.push({ access, refresh });
            cur = { accessToken: access, refreshToken: refresh };
        },
        clear: () => {
            cur = undefined;
        },
    };
    return { store, saves, current: () => cur };
}

function setup(opts: { initial?: { accessToken: string; refreshToken?: string }; leeway?: number } = {}) {
    const { fetchImpl, b } = makeBackend();
    const st = makeStore(opts.initial);
    const hub = createEventHub();
    const events: string[] = [];
    hub.subscribe((e) => events.push(e.type));
    const session = createSessionManager({ backendUrl: "http://backend", store: st.store, hub, fetchImpl, deviceLabel: "notebook-teste", refreshLeewayMs: opts.leeway });
    return { session, b, st, events };
}

test("login guarda access + refresh e manda o deviceLabel; sem expirar, nenhuma renovação acontece", async () => {
    const { session, b, st } = setup();
    await session.login("a@b.c", "senha");
    assert.equal(st.saves.at(-1)?.refresh, "RT-0");
    assert.ok(b.bodies[0].includes('"deviceLabel":"notebook-teste"'));
    assert.equal((await session.authedFetch("/probe")).status, 200);
    assert.equal(b.refreshCalls, 0);
});

test("renovação PREVENTIVA: access perto de expirar é trocado antes da chamada, e o par novo é gravado", async () => {
    const soon = jwt(20, "soon"); // expira em 20 s < leeway de 60 s
    const { session, b, st } = setup({ initial: { accessToken: soon, refreshToken: "RT-old" } });
    b.valid.add(soon);
    const r = await session.authedFetch("/probe");
    assert.equal(r.status, 200);
    assert.equal(b.refreshCalls, 1);
    assert.equal(st.saves.at(-1)?.refresh, "RT-1");
    assert.ok(b.log.findIndex((l) => l.includes("/auth/refresh")) < b.log.findIndex((l) => l.includes("/probe")), "renovou ANTES de chamar");
});

test("renovação REATIVA: 401 → refresh → repete UMA vez com o token novo (corpo reaproveitado)", async () => {
    const { session, b } = setup({ initial: { accessToken: jwt(3600, "revogado"), refreshToken: "RT-old" } });
    // o token guardado não está em b.valid → o backend responde 401
    const r = await session.authedFetch("/probe", { method: "POST", headers: { "Content-Type": "application/json" }, body: Buffer.from('{"x":1}') });
    assert.equal(r.status, 200);
    assert.equal(b.refreshCalls, 1);
    assert.equal(b.log.filter((l) => l.includes("/probe")).length, 2);
    assert.equal(b.bodies.filter((x) => x === '{"x":1}').length, 2, "o corpo foi reenviado");
});

test("SINGLE-FLIGHT: 6 chamadas concorrentes com o token vencendo geram UMA renovação", async () => {
    const soon = jwt(10, "soon");
    const { session, b } = setup({ initial: { accessToken: soon, refreshToken: "RT-old" } });
    b.valid.add(soon);
    const results = await Promise.all(Array.from({ length: 6 }, () => session.authedFetch("/probe")));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200, 200]);
    assert.equal(b.refreshCalls, 1);
});

test("o par novo vai pro disco ANTES da 1ª chamada que o usa", async () => {
    const soon = jwt(10, "soon");
    const order: string[] = [];
    const { fetchImpl, b } = makeBackend();
    b.valid.add(soon);
    const base = makeStore({ accessToken: soon, refreshToken: "RT-old" });
    const store: SessionStore = { ...base.store, save: (a, r) => { order.push("save"); base.store.save(a, r); } };
    const wrapped = (async (url: string, init?: RequestInit) => { if (String(url).endsWith("/probe")) order.push("probe"); return fetchImpl(url, init); }) as typeof fetch;
    const session = createSessionManager({ backendUrl: "http://backend", store, hub: createEventHub(), fetchImpl: wrapped });
    await session.authedFetch("/probe");
    assert.ok(order.indexOf("save") !== -1 && order.indexOf("save") < order.indexOf("probe"), `ordem: ${order.join(",")}`);
});

test("refresh REJEITADO (401): sessão limpa, session.expired publicado e nada mais é chamado", async () => {
    const { session, b, st, events } = setup({ initial: { accessToken: jwt(10, "x"), refreshToken: "RT-morto" } });
    b.refreshMode = "401";
    const r = await session.authedFetch("/probe");
    assert.equal(r.status, 401);
    assert.equal(session.isLoggedIn(), false);
    assert.equal(st.current(), undefined);
    assert.ok(events.includes("session.expired"));
    b.log.length = 0;
    assert.equal((await session.authedFetch("/probe")).status, 401);
    assert.equal(b.log.length, 0, "sem sessão não chama o backend");
});

test("falha de REDE ou 5xx na renovação NÃO desloga: a sessão continua guardada e a próxima chamada tenta de novo", async () => {
    for (const mode of ["network", "500"] as const) {
        const { session, b, st, events } = setup({ initial: { accessToken: jwt(3600, "velho"), refreshToken: "RT-ok" } });
        b.refreshMode = mode;
        const r = await session.authedFetch("/probe"); // 401 do backend + refresh falha por rede
        assert.equal(r.status, 401);
        assert.equal(session.isLoggedIn(), true, mode);
        assert.equal(st.current()?.refreshToken, "RT-ok");
        assert.ok(!events.includes("session.expired"), mode);
        b.refreshMode = "ok";
        assert.equal((await session.authedFetch("/probe")).status, 200, `${mode}: recuperou quando a rede voltou`);
    }
});

test("sessão LEGADA (JWT sem refresh): 401 expira como antes", async () => {
    const { session, events } = setup({ initial: { accessToken: jwt(3600, "legado") } });
    const r = await session.authedFetch("/probe");
    assert.equal(r.status, 401);
    assert.equal(session.isLoggedIn(), false);
    assert.ok(events.includes("session.expired"));
});

test("logout revoga no backend (com o refresh token) e limpa o disco", async () => {
    const { session, b, st } = setup();
    await session.login("a@b.c", "senha");
    session.logout();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(b.log.some((l) => l.includes("/auth/logout")));
    assert.ok(b.bodies.some((x) => x.includes("RT-0")));
    assert.equal(st.current(), undefined);
    assert.equal(session.isLoggedIn(), false);
});
