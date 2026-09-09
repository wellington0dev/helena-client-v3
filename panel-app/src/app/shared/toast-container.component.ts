import { Component, inject } from "@angular/core";
import { ToastService } from "../core/toast.service";
import { IconComponent } from "./icon.component";

/** Montado UMA VEZ no AppShell (fora do <router-outlet>) — visível em qualquer página, não só no Chat. Ver ToastService pra origem dos avisos. */
@Component({
    selector: "app-toast-container",
    imports: [IconComponent],
    templateUrl: "./toast-container.component.html",
    styleUrl: "./toast-container.component.css",
})
export class ToastContainerComponent {
    protected readonly toast = inject(ToastService);
}
