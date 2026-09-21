import { test } from "node:test";
import assert from "node:assert/strict";
import {
    cancelProject,
    createProject,
    deleteProject,
    getProject,
    getStepMessages,
    listAutonomyPolicies,
    listProjects,
    requestRevision,
    resumeProject,
    sendStepMessage,
    setAutonomyPolicy,
} from "./projects.ts";

const originalFetch = globalThis.fetch;
function restoreFetch(): void {
    globalThis.fetch = originalFetch;
}

test("listProjects: GET /projects", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify([{ id: "p1", spec: "app de lista", status: "active" }]), { status: 200 });
    }) as typeof fetch;
    try {
        const projects = await listProjects("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/projects");
        assert.equal(projects[0]?.id, "p1");
    } finally {
        restoreFetch();
    }
});

test("listAutonomyPolicies: rota fixa, nunca colide com :id", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ qa_failure: "auto", revision_scope_change: "ask" }), { status: 200 });
    }) as typeof fetch;
    try {
        const policies = await listAutonomyPolicies("http://127.0.0.1:4001", "jwt-fake");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/projects/autonomy-policies");
        assert.equal(policies.qa_failure, "auto");
    } finally {
        restoreFetch();
    }
});

test("setAutonomyPolicy: PATCH com {mode} no body", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ qa_failure: "ask", revision_scope_change: "ask" }), { status: 200 });
    }) as typeof fetch;
    try {
        await setAutonomyPolicy("http://127.0.0.1:4001", "jwt-fake", "qa_failure", "ask");
        assert.deepEqual(JSON.parse(capturedInit?.body as string), { mode: "ask" });
    } finally {
        restoreFetch();
    }
});

test("getProject: GET /projects/:id", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ project: { id: "p1" }, steps: [], events: [] }), { status: 200 });
    }) as typeof fetch;
    try {
        await getProject("http://127.0.0.1:4001", "jwt-fake", "p1");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/projects/p1");
    } finally {
        restoreFetch();
    }
});

test("createProject: POST com o input completo", async () => {
    let capturedInit: RequestInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({}), { status: 201 });
    }) as typeof fetch;
    try {
        await createProject("http://127.0.0.1:4001", "jwt-fake", { spec: "app de lista", machine: "veronica", costCapValue: 5, gitPushAllowed: true });
        assert.deepEqual(JSON.parse(capturedInit?.body as string), { spec: "app de lista", machine: "veronica", costCapValue: 5, gitPushAllowed: true });
    } finally {
        restoreFetch();
    }
});

test("requestRevision/resumeProject/cancelProject/deleteProject: rotas e métodos corretos", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
        calls.push({ url, method: init?.method, body: init?.body as string | undefined });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    try {
        await requestRevision("http://127.0.0.1:4001", "jwt-fake", "p1", ["qa"], "corrige o bug X");
        await resumeProject("http://127.0.0.1:4001", "jwt-fake", "p1");
        await cancelProject("http://127.0.0.1:4001", "jwt-fake", "p1", "motivo");
        await deleteProject("http://127.0.0.1:4001", "jwt-fake", "p1");

        assert.deepEqual(
            calls.map((c) => `${c.method} ${c.url}`),
            ["POST http://127.0.0.1:4001/projects/p1/revision", "POST http://127.0.0.1:4001/projects/p1/resume", "POST http://127.0.0.1:4001/projects/p1/cancel", "DELETE http://127.0.0.1:4001/projects/p1"],
        );
        assert.deepEqual(JSON.parse(calls[0]!.body!), { roles: ["qa"], note: "corrige o bug X" });
    } finally {
        restoreFetch();
    }
});

test("getStepMessages/sendStepMessage: codifica o role na URL", async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    }) as typeof fetch;
    try {
        await getStepMessages("http://127.0.0.1:4001", "jwt-fake", "p1", "frontend");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/projects/p1/steps/frontend/messages");

        await sendStepMessage("http://127.0.0.1:4001", "jwt-fake", "p1", "frontend", "oi");
        assert.equal(capturedUrl, "http://127.0.0.1:4001/projects/p1/steps/frontend/message");
    } finally {
        restoreFetch();
    }
});
