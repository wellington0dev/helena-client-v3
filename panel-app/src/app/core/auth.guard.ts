import { inject } from "@angular/core";
import type { CanActivateFn } from "@angular/router";
import { Router } from "@angular/router";
import { AuthService } from "./auth.service";

/**
 * Protege as rotas do shell (Chat/Canais/Perfil/Cobrança) — sem token, manda
 * pro /login. Bug real corrigido: `currentUser` (nome/email/número
 * vinculado etc.) só era populado por `loadMe()` dentro de login/register/
 * setOwnerIdentity — ao recarregar a página com um token já salvo em
 * localStorage, o token sobrevivia (`isAuthenticated()` true) mas
 * `currentUser` nascia `null` e NUNCA era buscado de novo, sumindo com
 * nome/email/número da tela até o próximo login. Este guard roda em toda
 * navegação pra rota protegida — inclusive a primeira depois de um reload —
 * então é o lugar certo pra garantir `currentUser` carregado antes de
 * liberar a rota.
 */
export const authGuard: CanActivateFn = async () => {
    const auth = inject(AuthService);
    if (!auth.isAuthenticated()) return inject(Router).parseUrl("/login");

    if (!auth.currentUser()) {
        try {
            await auth.loadMe();
        } catch {
            // Token salvo mas inválido/expirado (backend recusou /auth/me) — desloga de verdade em vez de deixar a tela presa sem dados.
            auth.logout();
            return false;
        }
    }

    return true;
};

/** Inverso — quem já tem token não deveria ver a tela de login/cadastro de novo. */
export const guestGuard: CanActivateFn = () => {
    const auth = inject(AuthService);
    if (!auth.isAuthenticated()) return true;
    return inject(Router).parseUrl("/chat");
};
