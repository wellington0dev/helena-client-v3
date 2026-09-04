import { config } from "../config.ts";

const MEDIA_MAX_BYTES = config.mediaMaxMb * 1024 * 1024;

/**
 * Checagem rápida com o tamanho que a própria plataforma reporta, ANTES de
 * baixar — evita gastar banda com uma imagem que já sabemos que vai ser
 * rejeitada (mesmo espírito de exceedsMediaLimit no backend single-owner).
 */
export function exceedsMediaLimit(sizeBytes: number | undefined): boolean {
    return sizeBytes !== undefined && sizeBytes > MEDIA_MAX_BYTES;
}

export function mediaTooLargeMessage(): string {
    return `Essa imagem é grande demais pra eu processar (limite: ${config.mediaMaxMb}MB) — manda uma menor, por favor.`;
}
