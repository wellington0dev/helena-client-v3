/** Backend HTTP calls made by local daemon services use the user's managed session. */
export type BackendSessionFetch = (path: string, init?: RequestInit) => Promise<Response>;

let fetchWithSession: BackendSessionFetch | undefined;

export function configureBackendSession(fetcher: BackendSessionFetch): void {
    fetchWithSession = fetcher;
}

export function backendSessionFetch(path: string, init?: RequestInit): Promise<Response> {
    if (!fetchWithSession) {
        return Promise.resolve(new Response(JSON.stringify({ error: "no_session", message: "Faça login para conectar a Helena." }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        }));
    }
    return fetchWithSession(path, init);
}
