import { Component, HostBinding, Input, inject } from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";

/** Mesmos SVGs inline do design original (Helena Panel.dc.html) — nomes fixos, sem lib de ícone nova. */
const ICONS: Record<string, string> = {
    chat: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1.2-4.2A8 8 0 1121 12z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    channels:
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="1.2" stroke="currentColor" stroke-width="2"/><path d="M17 14v3.5M17 21v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    profile:
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c1.2-3.8 4-5.7 7.5-5.7s6.3 1.9 7.5 5.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    billing:
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 7v10M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1.1-3 2.5c0 3 6 1.5 6 4.5 0 1.4-1.3 2.5-3 2.5s-3-1.1-3-2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    whatsapp:
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3a9 9 0 00-7.8 13.5L3 21l4.7-1.2A9 9 0 1012 3z" stroke="currentColor" stroke-width="2"/><path d="M8.5 9.5c.3 3 2.5 5.2 5.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    telegram:
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M6.5 12l10-4-3 10-3-3.3-2.5 2.3-.6-3.4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    sun: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M21 12.8A9 9 0 1111.2 3 7 7 0 0021 12.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    moon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.5" stroke="currentColor" stroke-width="2"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8l1.8-1.8M18 6l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    logout: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warning:
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 17h.01M10.3 3.9L2.5 17a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    menu: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    paperclip:
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 11.5l-8.5 8.5a4.5 4.5 0 01-6.4-6.4l9-9a3 3 0 014.3 4.3l-8.9 8.9a1.5 1.5 0 01-2.1-2.1l8-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

@Component({
    selector: "app-icon",
    template: "",
    host: { "[innerHTML]": "svg" },
})
export class IconComponent {
    private readonly sanitizer = inject(DomSanitizer);

    @Input({ required: true }) name!: keyof typeof ICONS | string;

    get svg(): SafeHtml {
        return this.sanitizer.bypassSecurityTrustHtml(ICONS[this.name] ?? "");
    }

    @HostBinding("style.display") display = "inline-flex";
    @HostBinding("style.lineHeight") lineHeight = "0";
}
