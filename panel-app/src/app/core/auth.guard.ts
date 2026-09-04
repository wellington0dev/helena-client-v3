import { inject } from "@angular/core";
import type { CanActivateFn } from "@angular/router";
import { Router } from "@angular/router";
import { AuthService } from "./auth.service";

/** Protege as rotas do shell (Chat/Canais/Perfil/Cobrança) — sem token, manda pro /login. */
export const authGuard: CanActivateFn = () => {
    const auth = inject(AuthService);
    if (auth.isAuthenticated()) return true;
    return inject(Router).parseUrl("/login");
};

/** Inverso — quem já tem token não deveria ver a tela de login/cadastro de novo. */
export const guestGuard: CanActivateFn = () => {
    const auth = inject(AuthService);
    if (!auth.isAuthenticated()) return true;
    return inject(Router).parseUrl("/chat");
};
