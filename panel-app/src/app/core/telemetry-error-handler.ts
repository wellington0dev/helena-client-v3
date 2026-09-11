import { HttpClient } from "@angular/common/http";
import { ErrorHandler, Injectable, inject } from "@angular/core";
import pkg from "../../../package.json";
import { AuthService } from "./auth.service";

/**
 * `provideBrowserGlobalErrorListeners()` (app.config.ts) já captura
 * `window.onerror`/`unhandledrejection` e encaminha pro `ErrorHandler`
 * registrado — mas sem UM CUSTOM aqui, o `ErrorHandler` padrão do Angular
 * só loga no console e não manda pra lugar nenhum. Achado em revisão
 * (2026-09-09): `POST /telemetry/logs` (backend-v2) já existe e funciona,
 * mas nada no painel/client/cli nunca chamava — os erros nunca chegavam
 * no painel admin mesmo pra quem tinha `telemetryConsent` ligado. Este
 * `ErrorHandler` fecha esse buraco, só pro painel (cli/client/ são
 * processos separados, cada um precisaria do próprio, fora de escopo
 * aqui).
 *
 * Teto simples de spam (20 relatos por carregamento de página + nunca
 * repete a MESMA mensagem duas vezes seguidas) — suficiente pro caso real
 * (erro de render em loop, clique repetido no mesmo botão quebrado) sem
 * inventar um rate-limiter de verdade. Nunca deixa o próprio envio (rede
 * fora, 403 sem consentimento) virar outro erro sem tratamento — sempre
 * `.subscribe({ error: () => {} })`, nunca deixa a Promise/Observable
 * rejeitar sem handler.
 *
 * Achado em revisão (2026-09-11): `appVersion`/`context` nunca eram
 * mandados — todo log de erro chegava no painel admin com "appVersion: —"
 * e sem stack visível pra alguns tipos de erro (ex: falha de import
 * dinâmico do próprio Angular Router, que às vezes não carrega stack
 * nenhuma do motor do navegador). `context` aqui é SÓ `url`/`userAgent` —
 * nunca conteúdo de mensagem nem dado inserido pela pessoa, mesma regra
 * de privacidade do resto da feature de telemetria.
 */
@Injectable()
export class TelemetryErrorHandler implements ErrorHandler {
    private readonly http = inject(HttpClient);
    private readonly auth = inject(AuthService);

    private reportedCount = 0;
    private lastMessage = "";
    private readonly maxReportsPerLoad = 20;

    handleError(error: unknown): void {
        console.error(error);

        if (!this.auth.currentUser()?.telemetryConsent) return;
        if (this.reportedCount >= this.maxReportsPerLoad) return;

        const message = error instanceof Error ? error.message : String(error);
        if (message === this.lastMessage) return;

        const stack = error instanceof Error ? error.stack : undefined;
        this.lastMessage = message;
        this.reportedCount++;

        this.http
            .post("/telemetry/logs", {
                level: "error",
                message: message.slice(0, 4000),
                stack: stack?.slice(0, 20000),
                source: "panel",
                appVersion: pkg.version,
                context: { url: location.href, userAgent: navigator.userAgent },
            })
            .subscribe({ error: () => {} });
    }
}
