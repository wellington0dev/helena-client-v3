import { documentError, localDocuments, type LocalDocumentWorkspace } from "./local-document-workspace.ts";
import type { DocumentFormat } from "./engine/contracts.ts";

/**
 * Tradução das capabilities `document_workspace_*` do protocolo `/ws/agent`
 * para a fachada local. Contrato de resultado (dentro de `exec-result.result`):
 *   sucesso:    { ok: true, ...dados }
 *   falha:      { ok: false, error: string, code: string }
 *
 * Nenhum payload aceita path de filesystem: tudo passa por IDs lógicos,
 * `workspaceId` validado e bytes em base64 quando há upload autorizado.
 */

export const DOCUMENT_WORKSPACE_CAPABILITIES = [
    "document_workspace_create",
    "document_workspace_import",
    "document_workspace_list",
    "document_workspace_inspect",
    "document_workspace_read",
    "document_workspace_edit",
    "document_workspace_export",
    "document_workspace_render",
    "document_workspace_remove",
    "document_workspace_capabilities",
    "document_workspace_download",
    "document_workspace_preview",
] as const;

type Payload = Record<string, unknown>;

function ok<T extends object>(data: T): { ok: true } & T {
    return { ok: true, ...data };
}

export async function dispatchDocumentCapability(
    capability: string,
    payload: unknown,
    workspace?: LocalDocumentWorkspace,
): Promise<unknown> {
    const documents = workspace ?? localDocuments();
    const input = (payload && typeof payload === "object" ? payload : {}) as Payload;
    const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : undefined;

    try {
        switch (capability) {
            case "document_workspace_create": {
                if (!input.format || typeof input.filename !== "string") {
                    return documentError(new Error("`format` e `filename` são obrigatórios."));
                }
                const created = await documents.create(input as never, workspaceId);
                return ok({ ...created, documentId: created.document.id, document: created.document });
            }
            case "document_workspace_import": {
                if (typeof input.filename !== "string" || typeof input.mimeType !== "string" || typeof input.bytesBase64 !== "string") {
                    return documentError(new Error("`filename`, `mimeType` e `bytesBase64` são obrigatórios."));
                }
                const bytes = Buffer.from(input.bytesBase64, "base64");
                const result = await documents.importFile(input.filename, input.mimeType, bytes, workspaceId);
                return ok({ documentId: result.document.id, document: result.document, summary: result.summary });
            }
            case "document_workspace_list": {
                const limit = typeof input.limit === "number" ? input.limit : undefined;
                return ok({ documents: documents.list(workspaceId, limit) });
            }
            case "document_workspace_inspect": {
                if (typeof input.documentId !== "string") return documentError(new Error("`documentId` é obrigatório."));
                return ok({ document: await documents.inspect(input.documentId, workspaceId) });
            }
            case "document_workspace_read": {
                if (typeof input.documentId !== "string") return documentError(new Error("`documentId` é obrigatório."));
                const read = await documents.read(input.documentId, {
                    ...(typeof input.offset === "number" && { offset: input.offset }),
                    ...(typeof input.limit === "number" && { limit: input.limit }),
                }, workspaceId);
                return ok(read);
            }
            case "document_workspace_edit": {
                if (typeof input.documentId !== "string") return documentError(new Error("`documentId` é obrigatório."));
                const operations = input.operations;
                if (!Array.isArray(operations) || operations.length === 0) {
                    return documentError(new Error("Informe ao menos uma operação."));
                }
                const result = await documents.edit({
                    documentId: input.documentId,
                    operations: operations as never,
                    ...(typeof input.expectedRevision === "number" && { expectedRevision: input.expectedRevision }),
                }, workspaceId);
                return ok({ documentId: result.document.id, document: result.document, summary: result.summary, ...(result.warnings && { warnings: result.warnings }) });
            }
            case "document_workspace_export": {
                if (typeof input.documentId !== "string" || typeof input.format !== "string") {
                    return documentError(new Error("`documentId` e `format` são obrigatórios."));
                }
                const result = await documents.export(input.documentId, input.format as DocumentFormat, workspaceId);
                return ok({ documentId: result.document.id, document: result.document, summary: result.summary });
            }
            case "document_workspace_render": {
                if (typeof input.documentId !== "string") return documentError(new Error("`documentId` é obrigatório."));
                const doc = await documents.inspect(input.documentId, workspaceId);
                const preview = await documents.render(input.documentId, workspaceId);
                return ok({
                    documentId: doc.id,
                    previewUrl: doc.previewUrl,
                    downloadUrl: doc.downloadUrl,
                    fidelity: preview.fidelity,
                    mimeType: preview.mimeType,
                    ...(preview.note && { note: preview.note }),
                });
            }
            case "document_workspace_remove": {
                if (typeof input.documentId !== "string") return documentError(new Error("`documentId` é obrigatório."));
                return ok({ removed: await documents.remove(input.documentId, workspaceId) });
            }
            case "document_workspace_capabilities": {
                return ok({ capabilities: await documents.capabilities() });
            }
            case "document_workspace_download": {
                if (typeof input.documentId !== "string") return documentError(new Error("`documentId` é obrigatório."));
                const found = await documents.bytes(input.documentId, workspaceId);
                return ok({
                    documentId: found.identity.id,
                    filename: found.identity.filename,
                    mimeType: found.identity.mimeType,
                    size: found.bytes.byteLength,
                    bytesBase64: found.bytes.toString("base64"),
                });
            }
            case "document_workspace_preview": {
                if (typeof input.documentId !== "string") return documentError(new Error("`documentId` é obrigatório."));
                const doc = await documents.inspect(input.documentId, workspaceId);
                const token = new URL(doc.previewUrl).searchParams.get("token") ?? "";
                const preview = await documents.previewByToken(input.documentId, token);
                if (!preview) return documentError(new Error("Prévia indisponível."));
                return ok({
                    documentId: doc.id,
                    fidelity: preview.fidelity,
                    mimeType: preview.mimeType,
                    bytesBase64: preview.bytes.toString("base64"),
                    ...(preview.note && { note: preview.note }),
                });
            }
            default:
                return documentError(new Error(`capability documental desconhecida: "${capability}"`));
        }
    } catch (error) {
        return documentError(error);
    }
}
