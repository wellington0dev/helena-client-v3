import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { AuthService } from "../../core/auth.service";

@Component({
    selector: "app-auth",
    imports: [FormsModule],
    templateUrl: "./auth.component.html",
    styleUrl: "./auth.component.css",
})
export class AuthComponent {
    private readonly auth = inject(AuthService);
    private readonly router = inject(Router);

    protected readonly mode = signal<"login" | "register">("login");
    protected readonly error = signal("");
    protected readonly busy = signal(false);
    protected email = "";
    protected password = "";
    protected name = "";

    setMode(mode: "login" | "register"): void {
        this.mode.set(mode);
        this.error.set("");
    }

    async submit(): Promise<void> {
        if (this.password.length > 0 && this.password.length < 8) {
            this.error.set("A senha precisa ter no mínimo 8 caracteres.");
            return;
        }
        this.busy.set(true);
        this.error.set("");
        try {
            if (this.mode() === "register") {
                await this.auth.register(this.email, this.password, this.name || undefined);
            } else {
                await this.auth.login(this.email, this.password);
            }
            await this.router.navigateByUrl("/chat");
        } catch (err) {
            this.error.set(err instanceof Error ? err.message : "Falha ao entrar.");
        } finally {
            this.busy.set(false);
        }
    }
}
