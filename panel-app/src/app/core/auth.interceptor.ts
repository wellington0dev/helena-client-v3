import type { HttpInterceptorFn } from "@angular/common/http";
import { inject } from "@angular/core";
import { API_BASE_URL } from "./api-base.token";
import { AuthService } from "./auth.service";

/** Prefixa toda chamada relativa (`/auth/...`, `/chat/...`) com o backend-v2 real (injetado em runtime) e anexa o JWT quando existir. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
    const baseUrl = inject(API_BASE_URL);
    const token = inject(AuthService).token();

    const url = /^https?:\/\//.test(req.url) ? req.url : baseUrl + req.url;
    const headers = token ? req.headers.set("Authorization", `Bearer ${token}`) : req.headers;

    return next(req.clone({ url, headers }));
};
