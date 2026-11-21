import path from "node:path";
import { config } from "../config.ts";
import { configDir } from "../local-api/paths.ts";
import {
    CSV_MIME_TYPE,
    DOCX_MIME_TYPE,
    DOCUMENT_MIME_TYPES,
    PDF_MIME_TYPE,
    PPTX_MIME_TYPE,
    TEXT_MIME_TYPE,
    XLSX_MIME_TYPE,
} from "./data-files-adapter.ts";
import { assertCreateLimits, assertEditLimits, assertImportSize, DOCUMENT_LIMITS, DocumentLimitError } from "./document-limits.ts";
import { CoreDocumentEngine, InMemoryEngineStore } from "./engine/engine.ts";
import { DocumentValidationError } from "./engine/ooxml.ts";
import type {
    CreateDocumentInput,
    CreateSpreadsheetInput,
    DocxOperation,
    DocumentCapabilities,
    DocumentFormat,
    DocumentIdentity,
    DocumentResult,
    EditDocumentInput,
    EditSpreadsheetInput,
    SpreadsheetOperation,
} from "./engine/contracts.ts";
import { LocalDocumentStore } from "./local-document-store.ts";

/**
 * Fachada do executor Local. Espelha `DocumentWorkspaceService` do backend,
 * mas roda dentro do daemon do Client: nenhuma operação recebe path — apenas
 * IDs lógicos,(bytes e nomes de exibição). O store é isolado sob o diretório
 * de config da Helena, nunca na pasta de arquivos pessoais do usuário.
 *
 * Diferença intencional do Cloud: não há `userId` (o daemon é da máquina), então
 * o workspace é prefixado por `local:` em vez de `<userId>:`. Ainda assim o
 * `workspaceId` vindo do modelo é validado e nunca vira path.
 */

export const LOCAL_DOCUMENT_UPLOAD_MIME_TYPES = [
    DOCX_MIME_TYPE,
    XLSX_MIME_TYPE,
    PPTX_MIME_TYPE,
    PDF_MIME_TYPE,
    CSV_MIME_TYPE,
    TEXT_MIME_TYPE,
] as const;

/** Documento devolvido ao painel: identidade + links opacos, nunca paths. */
export interface DocumentView extends DocumentIdentity {
    downloadUrl: string;
    previewUrl: string;
}

export interface DocumentMutationResult extends Omit<DocumentResult, "document"> {
    document: DocumentView;
}

export interface DocumentArtifactRef {
    documentId: string;
    filename: string;
    format: DocumentFormat;
    revision: number;
    downloadUrl: string;
    previewUrl: string;
}

export interface DocumentErrorEnvelope {
    ok: false;
    error: string;
    code: string;
}

/** `workspaceId` é injetado pela fachada — quem chama nunca fornece o escopo. */
export type LocalCreateInput =
    | (Omit<CreateDocumentInput, "workspaceId"> & { workspaceId?: string })
    | (Omit<CreateSpreadsheetInput, "workspaceId"> & { workspaceId?: string });

const FORMAT_BY_MIME: Record<string, DocumentFormat> = {
    [DOCX_MIME_TYPE]: "docx",
    [XLSX_MIME_TYPE]: "xlsx",
    [PPTX_MIME_TYPE]: "pptx",
    [PDF_MIME_TYPE]: "pdf",
    [CSV_MIME_TYPE]: "csv",
    [TEXT_MIME_TYPE]: "txt",
};

const WORKSPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;

/** Prefixo fixo do dono do daemon; o modelo não pode trocá-lo. */
export function canonicalWorkspace(requested?: string): string {
    if (requested === undefined || requested === "" || requested === "default") return "local:default";
    if (!WORKSPACE_PATTERN.test(requested)) {
        throw new DocumentValidationError("workspaceId inválido (use letras, números, '-' e '_', até 64 caracteres).", "BAD_WORKSPACE");
    }
    return `local:${requested}`;
}

export function formatFromMime(mimeType: string): DocumentFormat {
    const format = FORMAT_BY_MIME[mimeType];
    if (!format) throw new DocumentValidationError(`Formato não suportado no Document Workspace: "${mimeType}".`, "BAD_FORMAT");
    return format;
}

/** Converte erros internos em envelope estável para as capabilities do WS. */
export function documentError(error: unknown): DocumentErrorEnvelope {
    if (error instanceof DocumentValidationError || error instanceof DocumentLimitError) {
        return { ok: false, error: error.message, code: error.code };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error), code: "INTERNAL" };
}

export class LocalDocumentWorkspace {
    readonly store: LocalDocumentStore;
    private readonly baseUrl: string;

    constructor(options: { root?: string; baseUrl?: string } = {}) {
        const root = options.root ?? path.join(configDir(), "local-documents");
        this.store = new LocalDocumentStore(root);
        this.baseUrl = (options.baseUrl ?? `http://${config.localBind === "0.0.0.0" ? "127.0.0.1" : config.localBind}:${config.localPort}`).replace(/\/$/, "");
    }

    private url(id: string, token: string, action: "download" | "preview"): string {
        return `${this.baseUrl}/v1/local-documents/${id}/${action}?token=${token}`;
    }

    private view(identity: DocumentIdentity): DocumentView {
        const token = this.store.tokenOf(identity.id);
        if (!token) throw new DocumentValidationError("Token do documento indisponível.", "BAD_ARTIFACT");
        return {
            ...identity,
            downloadUrl: this.url(identity.id, token, "download"),
            previewUrl: this.url(identity.id, token, "preview"),
        };
    }

    private result(result: DocumentResult): DocumentMutationResult {
        return { ...result, document: this.view(result.document) };
    }

    /** Cada chamada usa uma engine com store de escopo fixo — nenhuma capability atravessa workspaces. */
    private engine(workspace?: string): CoreDocumentEngine {
        if (workspace !== undefined) canonicalWorkspace(workspace); // valida cedo, sem confiar no modelo
        return new CoreDocumentEngine(this.store, "local");
    }

    /** Confere que o ID pertence ao workspace pedido antes de qualquer leitura. */
    private scoped<T extends DocumentIdentity>(identity: T, workspace?: string): T {
        if (workspace === undefined) return identity;
        const expected = canonicalWorkspace(workspace);
        if (identity.workspaceId !== expected) {
            throw new DocumentValidationError(`Documento "${identity.id}" não encontrado.`, "NOT_FOUND");
        }
        return identity;
    }

    async create(
        input: LocalCreateInput,
        workspace?: string,
    ): Promise<DocumentMutationResult> {
        assertCreateLimits(input as CreateDocumentInput | CreateSpreadsheetInput);
        const canonical = canonicalWorkspace(workspace);
        return this.result(await this.engine(workspace).create({ ...input, workspaceId: canonical } as CreateDocumentInput | CreateSpreadsheetInput));
    }

    async importFile(
        filename: string,
        mimeType: string,
        bytes: Buffer,
        workspace?: string,
    ): Promise<DocumentMutationResult> {
        assertImportSize(bytes.byteLength);
        return this.result(await this.engine(workspace).import({
            workspaceId: canonicalWorkspace(workspace),
            filename,
            format: formatFromMime(mimeType),
            bytes,
        }));
    }

    list(workspace?: string, limit: number = DOCUMENT_LIMITS.listLimit): DocumentView[] {
        const safeLimit = Math.min(DOCUMENT_LIMITS.listLimit, Math.max(1, Math.floor(limit)));
        return this.store
            .list(canonicalWorkspace(workspace), safeLimit)
            .map((identity) => this.view(identity));
    }

    async inspect(documentId: string, workspace?: string): Promise<DocumentView> {
        return this.view(this.scoped(await this.engine(workspace).inspect(documentId), workspace));
    }

    async read(
        documentId: string,
        options: { offset?: number; limit?: number } = {},
        workspace?: string,
    ): Promise<{ text: string; truncated: boolean }> {
        if (workspace !== undefined) {
            const identity = await this.engine(workspace).inspect(documentId);
            this.scoped(identity, workspace);
        }
        return this.engine(workspace).read(documentId, options);
    }

    async render(documentId: string, workspace?: string): Promise<{ mimeType: string; bytes: Buffer; fidelity: string; note?: string }> {
        if (workspace !== undefined) this.scoped(await this.engine(workspace).inspect(documentId), workspace);
        const preview = await this.engine(workspace).render(documentId);
        const bytes = Buffer.from(preview.bytes);
        if (bytes.byteLength > DOCUMENT_LIMITS.previewBytes) throw new DocumentLimitError("Prévia grande demais para ser transmitida.");
        return { mimeType: preview.mimeType, bytes, fidelity: preview.fidelity, note: preview.note };
    }

    async edit(
        input: {
            documentId: string;
            operations: Array<DocxOperation | SpreadsheetOperation>;
            expectedRevision?: number;
        },
        workspace?: string,
    ): Promise<DocumentMutationResult> {
        assertEditLimits(input.operations);
        if (workspace !== undefined) {
            const identity = await this.engine(workspace).inspect(input.documentId);
            this.scoped(identity, workspace);
        }
        return this.result(await this.engine(workspace).edit(input as EditDocumentInput | EditSpreadsheetInput));
    }

    async export(documentId: string, format: DocumentFormat, workspace?: string): Promise<DocumentMutationResult> {
        if (workspace !== undefined) {
            const identity = await this.engine(workspace).inspect(documentId);
            this.scoped(identity, workspace);
        }
        return this.result(await this.engine(workspace).export(documentId, format));
    }

    async remove(documentId: string, workspace?: string): Promise<boolean> {
        try {
            const identity = await this.engine(workspace).inspect(documentId);
            this.scoped(identity, workspace);
        } catch (error) {
            if (error instanceof DocumentValidationError && error.code === "NOT_FOUND") return false;
            throw error;
        }
        await this.store.delete(documentId);
        return true;
    }

    /** Bytes originais para relay autorizado (capability `document_workspace_download`). */
    async bytes(documentId: string, workspace?: string): Promise<{ identity: DocumentIdentity; bytes: Buffer }> {
        const identity = await this.engine(workspace).inspect(documentId);
        this.scoped(identity, workspace);
        const stored = await this.store.get(documentId);
        if (!stored) throw new DocumentValidationError(`Documento "${documentId}" não encontrado.`, "NOT_FOUND");
        return stored;
    }

    async capabilities(): Promise<DocumentCapabilities[]> {
        return this.engine().capabilities();
    }

    /** Credencial de curto prazo opaca: abre download/prévia no navegador sem JWT em URL. */
    byToken(documentId: string, token: string): { identity: DocumentIdentity; bytes: Buffer } | undefined {
        if (!TOKEN_PATTERN.test(token)) return undefined;
        return this.store.findByToken(documentId, token);
    }

    /** Prévia para `<iframe>`: autenticada pelo token opaco, nunca por bearer. */
    async previewByToken(documentId: string, token: string): Promise<{ mimeType: string; bytes: Buffer; fidelity: string; note?: string } | undefined> {
        const found = this.byToken(documentId, token);
        if (!found) return undefined;
        // Store efêmero: a rota pública nunca recebe o store persistente do daemon.
        const temporary = new InMemoryEngineStore();
        await temporary.put({ identity: found.identity, bytes: found.bytes });
        const preview = await new CoreDocumentEngine(temporary, "local").render(found.identity.id);
        const bytes = Buffer.from(preview.bytes);
        if (bytes.byteLength > DOCUMENT_LIMITS.previewBytes) throw new DocumentLimitError("Prévia grande demais para ser transmitida.");
        return { mimeType: preview.mimeType, bytes, fidelity: preview.fidelity, note: preview.note };
    }

    async artifact(documentId: string, workspace?: string): Promise<DocumentArtifactRef> {
        const doc = await this.inspect(documentId, workspace);
        return {
            documentId: doc.id,
            filename: doc.filename,
            format: doc.format,
            revision: doc.revision,
            downloadUrl: doc.downloadUrl,
            previewUrl: doc.previewUrl,
        };
    }
}

/** Instância única do daemon — usada pelas capabilities WS e pelas rotas HTTP tokenizadas. */
let shared: LocalDocumentWorkspace | undefined;
export function localDocuments(): LocalDocumentWorkspace {
    shared ??= new LocalDocumentWorkspace();
    return shared;
}

export { DOCUMENT_MIME_TYPES };
