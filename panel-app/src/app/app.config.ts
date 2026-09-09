import { provideHttpClient, withInterceptors } from "@angular/common/http";
import type { ApplicationConfig } from "@angular/core";
import { ErrorHandler, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideRouter } from "@angular/router";
import { authInterceptor } from "./core/auth.interceptor";
import { TelemetryErrorHandler } from "./core/telemetry-error-handler";
import { routes } from "./app.routes";

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor])),
        { provide: ErrorHandler, useClass: TelemetryErrorHandler },
    ],
};
