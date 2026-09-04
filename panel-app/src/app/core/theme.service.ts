import { Injectable, effect, signal } from "@angular/core";

const THEME_KEY = "helena_panel_theme";
export type Theme = "dark" | "light";

/** Persiste em localStorage (mesma chave usada antes da migração) e aplica `data-theme` na raiz do documento — o CSS de tema lê esse atributo (ver styles/theme.css). */
@Injectable({ providedIn: "root" })
export class ThemeService {
    readonly theme = signal<Theme>(this.readInitial());

    constructor() {
        effect(() => {
            const value = this.theme();
            if (typeof document !== "undefined") document.documentElement.setAttribute("data-theme", value);
            if (typeof localStorage !== "undefined") localStorage.setItem(THEME_KEY, value);
        });
    }

    toggle(): void {
        this.theme.set(this.theme() === "dark" ? "light" : "dark");
    }

    private readInitial(): Theme {
        if (typeof localStorage === "undefined") return "dark";
        return (localStorage.getItem(THEME_KEY) as Theme) || "dark";
    }
}
