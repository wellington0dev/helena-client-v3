import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { DocumentIdentity } from "./engine/contracts.ts";
import type { EngineDocument, EngineStore } from "./engine/engine.ts";
import { DocumentValidationError } from "./engine/ooxml.ts";

/**
 * Store do executor Local. Mesma semântica do `PersistentDocumentStore` do
 * Cloud: IDs lógicos opacos, revisão monotônica, CAS no commit e token opaco
 * rotacionado SOMENTE quando a revisão muda. Nenhum caminho vem do modelo —
 * o único material de path é o UUID interno, validado antes de compor.
 *
 * Física: `<root>/docs/<uuid>/r<rev>` (bytes) + `meta.json` (identidade +
 * token). `<root>` fica sob o diretório de config do Client, nunca na pasta
 * de arquivos pessoais do usuário.
 */

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[0-9a-f]{48}$/;
const MAX_SCAN = 10_000;
const DOCUMENT_LIST_HARD_MAX = 100;

interface Meta {
    identity: DocumentIdentity;
    downloadToken: string;
}

function newToken(): string {
    return randomBytes(24).toString("hex");
}

function assertId(id: string): void {
    if (!ID_PATTERN.test(id)) throw new DocumentValidationError("ID de documento inválido.", "NOT_FOUND");
}

function tokenEquals(a: string, b: string): boolean {
    if (!TOKEN_PATTERN.test(a) || !TOKEN_PATTERN.test(b)) return false;
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

function atomicWrite(target: string, bytes: string | Buffer): void {
    const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, bytes, { mode: 0o600 });
    fs.renameSync(tmp, target);
}

export class LocalDocumentStore implements EngineStore {
    private readonly docsDir: string;
    /** Fila por documento — serializa get→put para CAS real sob edições concorrentes. */
    private readonly tails = new Map<string, Promise<void>>();

    readonly root: string;

    constructor(root: string) {
        this.root = path.resolve(root);
        this.docsDir = path.join(this.root, "docs");
        fs.mkdirSync(this.docsDir, { recursive: true, mode: 0o700 });
    }

    private docDir(id: string): string {
        assertId(id);
        return path.join(this.docsDir, id);
    }

    private metaPath(id: string): string {
        return path.join(this.docDir(id), "meta.json");
    }

    private revisionPath(id: string, revision: number): string {
        return path.join(this.docDir(id), `r${revision}`);
    }

    private readMeta(id: string): Meta | undefined {
        try {
            return JSON.parse(fs.readFileSync(this.metaPath(id), "utf8")) as Meta;
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            throw new DocumentValidationError("Metadados do documento corrompidos.", "BAD_ARTIFACT");
        }
    }

    private async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(id) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const chain = previous.then(() => gate);
        this.tails.set(id, chain);
        await previous;
        try {
            return await fn();
        } finally {
            release();
            void chain.then(() => { if (this.tails.get(id) === chain) this.tails.delete(id); });
        }
    }

    async get(id: string): Promise<EngineDocument | undefined> {
        const meta = this.readMeta(id);
        if (!meta || meta.identity.status === "deleted") return undefined;
        let bytes: Buffer;
        try {
            bytes = fs.readFileSync(this.revisionPath(id, meta.identity.revision));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                throw new DocumentValidationError("O bytes desta revisão não está mais disponível.", "BAD_ARTIFACT");
            }
            throw err;
        }
        return { identity: meta.identity, bytes };
    }

    async put(document: EngineDocument, expectedRevision?: number): Promise<void> {
        const { identity, bytes } = document;
        assertId(identity.id);
        await this.withLock(identity.id, async () => {
            const existing = this.readMeta(identity.id);
            const expected = expectedRevision ?? existing?.identity.revision;
            if (expected !== undefined && existing && expected !== existing.identity.revision) {
                throw new DocumentValidationError(
                    `Revisão esperada ${expected}, mas o documento está na revisão ${existing.identity.revision}.`,
                    "REVISION_CONFLICT",
                );
            }
            const revisionChanged = !existing || existing.identity.revision !== identity.revision;
            const downloadToken = revisionChanged ? newToken() : (existing?.downloadToken ?? newToken());
            const dir = this.docDir(identity.id);
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
            atomicWrite(this.revisionPath(identity.id, identity.revision), bytes);
            atomicWrite(this.metaPath(identity.id), JSON.stringify({ identity, downloadToken } satisfies Meta));
            if (existing && existing.identity.revision !== identity.revision) {
                const stale = this.revisionPath(identity.id, existing.identity.revision);
                if (stale !== this.revisionPath(identity.id, identity.revision)) {
                    fs.rmSync(stale, { force: true });
                }
            }
        });
    }

    async delete(id: string): Promise<void> {
        assertId(id);
        await this.withLock(id, async () => {
            fs.rmSync(this.docDir(id), { recursive: true, force: true });
        });
    }

    tokenOf(id: string): string | undefined {
        return this.readMeta(id)?.downloadToken;
    }

    /** Capability opaca: compara em tempo constante e nunca expõe o token em log. */
    findByToken(id: string, token: string): EngineDocument | undefined {
        assertId(id);
        const meta = this.readMeta(id);
        if (!meta || meta.identity.status === "deleted" || !tokenEquals(token, meta.downloadToken)) return undefined;
        let bytes: Buffer;
        try {
            bytes = fs.readFileSync(this.revisionPath(id, meta.identity.revision));
        } catch {
            return undefined;
        }
        return { identity: meta.identity, bytes };
    }

    /** Lista metadados (sem bytes) de um workspace lógico. Nunca lê paths de fora do root. */
    list(workspaceId: string, limit: number): DocumentIdentity[] {
        let entries: string[];
        try {
            entries = fs.readdirSync(this.docsDir);
        } catch {
            return [];
        }
        const result: DocumentIdentity[] = [];
        for (const entry of entries.slice(0, MAX_SCAN)) {
            if (!ID_PATTERN.test(entry)) continue;
            const meta = this.readMeta(entry);
            if (meta && meta.identity.status === "available" && meta.identity.workspaceId === workspaceId) {
                result.push(meta.identity);
            }
        }
        return result
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, Math.max(0, Math.min(limit, DOCUMENT_LIST_HARD_MAX)));
    }
}


