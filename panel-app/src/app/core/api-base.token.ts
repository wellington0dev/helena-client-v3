import { InjectionToken } from "@angular/core";

declare global {
    interface Window {
        __BACKEND_V2_URL__?: string;
    }
}

/**
 * URL do backend-v2 — injetada em runtime pelo `client/` (ver server.ts:
 * substitui um placeholder no `index.html` já buildado), nunca fixada em
 * tempo de build: cada `client/` roda na máquina de um usuário diferente,
 * com o próprio `.env`, então o mesmo bundle Angular precisa servir pra
 * qualquer backend-v2 configurado sem rebuild.
 */
export const API_BASE_URL = new InjectionToken<string>("API_BASE_URL", {
    providedIn: "root",
    factory: () => (typeof window !== "undefined" && window.__BACKEND_V2_URL__) || "",
});
