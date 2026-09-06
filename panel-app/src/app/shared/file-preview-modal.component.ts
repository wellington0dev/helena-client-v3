import { Component, EventEmitter, Input, Output, inject, signal, type OnChanges, type SimpleChanges } from "@angular/core";
import type { DataFileKind, DataFilePreview } from "../core/chat.service";
import { ChatService } from "../core/chat.service";
import { IconComponent } from "./icon.component";

export interface ModalFile {
    fileId: string;
    kind: DataFileKind;
    downloadUrl: string;
    filename: string;
}

/**
 * Overlay simples — não existia nenhum modal no painel ainda (o de `web/`
 * foi apagado junto do resto do backend antigo). Dois modos: imagem em
 * tamanho cheio, ou tabela de verdade (primeiras linhas) pra CSV/XLSX,
 * buscada em `ChatService#previewRows` só quando o arquivo muda — nunca
 * refaz a busca à toa (`ngOnChanges` compara `fileId`).
 */
@Component({
    selector: "app-file-preview-modal",
    imports: [IconComponent],
    templateUrl: "./file-preview-modal.component.html",
    styleUrl: "./file-preview-modal.component.css",
})
export class FilePreviewModalComponent implements OnChanges {
    private readonly chat = inject(ChatService);

    @Input({ required: true }) file!: ModalFile;
    @Output() closed = new EventEmitter<void>();

    protected readonly preview = signal<DataFilePreview | null>(null);
    protected readonly previewError = signal("");
    protected readonly loading = signal(false);

    ngOnChanges(changes: SimpleChanges): void {
        if (!changes["file"] || this.file.kind === "image") return;
        void this.loadPreview();
    }

    private async loadPreview(): Promise<void> {
        this.loading.set(true);
        this.previewError.set("");
        this.preview.set(null);
        try {
            const result = await this.chat.previewRows(this.file.fileId);
            if ("error" in result) this.previewError.set(result.error);
            else this.preview.set(result);
        } catch (err) {
            this.previewError.set(err instanceof Error ? err.message : "Falha ao carregar prévia.");
        } finally {
            this.loading.set(false);
        }
    }

    close(): void {
        this.closed.emit();
    }
}
