import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
    LocalSkillsProviderError,
    MAX_LOCAL_SKILL_CONTENT_BYTES,
    MAX_LOCAL_SKILL_DESCRIPTION_BYTES,
    type LocalSkillMetadata,
} from "./local-skills-protocol.ts";
import { InvalidSkillFile, LocalSkillsCatalog, MAX_LOCAL_SKILL_FILE_BYTES, parseLocalSkillMarkdown } from "./local-skills.ts";
import { GitHubSkillImporter, GitHubSkillImportError, parseGitHubSkillSource, type GitHubSkillCatalog } from "./github-skills.ts";

const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION = /^sha256:[a-f0-9]{64}$/;
const MAX_ID_LENGTH = 64;
export interface SkillDraft {
    skillId: string;
    description: string;
    instructions: string;
}

interface SkillState {
    enabled: boolean;
    source: string;
}

export interface SkillPreview extends SkillDraft {
    [key: string]: unknown;
}
export interface RemoteSkillPreview extends SkillPreview {
    source: string;
    sourceRevision: string;
    skillPath: string;
    unsupportedFiles: string[];
}

function byteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
}

function validateDraft(draft: SkillDraft): void {
    if (!SKILL_ID.test(draft.skillId) || draft.skillId.length > MAX_ID_LENGTH) {
        throw new LocalSkillsProviderError("not_found", "Identificador inválido.");
    }
    if (typeof draft.description !== "string" || !draft.description.trim() || byteLength(draft.description) > MAX_LOCAL_SKILL_DESCRIPTION_BYTES) {
        throw new LocalSkillsProviderError("not_found", "Descrição inválida.");
    }
    if (typeof draft.instructions !== "string" || !draft.instructions.trim() || byteLength(draft.instructions) > MAX_LOCAL_SKILL_CONTENT_BYTES) {
        throw new LocalSkillsProviderError("payload_too_large", "Instruções inválidas ou acima do limite.");
    }
}

function markdownFor(draft: SkillDraft): string {
    validateDraft(draft);
    // JSON string quoting is a valid YAML double-quoted scalar and avoids
    // interpreting user-provided punctuation as frontmatter syntax.
    const output = `---\nname: ${JSON.stringify(draft.skillId)}\ndescription: ${JSON.stringify(draft.description.trim())}\n---\n\n${draft.instructions.trim()}\n`;
    if (byteLength(output) > MAX_LOCAL_SKILL_FILE_BYTES) {
        throw new LocalSkillsProviderError("payload_too_large", "A skill excede o limite de tamanho.");
    }
    return output;
}

function parseMarkdown(content: string): SkillPreview {
    if (typeof content !== "string" || byteLength(content) > MAX_LOCAL_SKILL_FILE_BYTES) {
        throw new LocalSkillsProviderError("payload_too_large", "O arquivo excede o limite de 32 KB.");
    }
    try {
        const parsed = parseLocalSkillMarkdown(content);
        const draft = { skillId: parsed.name, description: parsed.description, instructions: parsed.instructions };
        validateDraft(draft);
        return draft;
    } catch (error) {
        if (error instanceof InvalidSkillFile) {
            if (error.reason.startsWith("unsupported_metadata:")) {
                throw new LocalSkillsProviderError("incompatible_skill", `Metadado não suportado: ${error.reason.slice("unsupported_metadata:".length)}.`);
            }
            if (error.reason.startsWith("duplicate_frontmatter_field:")) {
                throw new LocalSkillsProviderError("incompatible_skill", `Metadado duplicado: ${error.reason.slice("duplicate_frontmatter_field:".length)}.`);
            }
            throw new LocalSkillsProviderError("incompatible_skill", `SKILL.md incompatível com o Client (${error.reason}).`);
        }
        throw error;
    }
}

/**
 * Filesystem manager for personal skills. All bodies and enable/source state
 * remain on this device; state is a tiny local sidecar, never sent in list.
 */
export class LocalSkillsManager extends LocalSkillsCatalog {
    private readonly configuredRoot: string;
    private readonly locks = new Set<string>();
    private readonly github: GitHubSkillImporter;

    constructor(rootPath: string, githubImporter = new GitHubSkillImporter()) {
        super(rootPath);
        this.configuredRoot = path.resolve(rootPath);
        this.github = githubImporter;
    }

    previewMarkdown(content: string): SkillPreview {
        return parseMarkdown(content);
    }

    async previewGit(source: string, skillPath?: string): Promise<Record<string, unknown>> {
        try {
            if (skillPath === undefined) {
                const catalog = await this.github.discover(source);
                return this.catalogResult(catalog);
            }
            const remote = await this.github.preview(source, skillPath);
            if (remote.unsupportedFiles.length) {
                // Keep the inventory in the preview. The UI disables install rather than silently
                // dropping resources that the current local format cannot preserve.
            }
            const draft = parseMarkdown(remote.markdown);
            return {
                kind: "preview",
                ...draft,
                source: remote.source,
                sourceRevision: remote.sourceRevision,
                skillPath: remote.skillPath,
                unsupportedFiles: remote.unsupportedFiles,
            };
        } catch (error) {
            throw this.providerError(error);
        }
    }

    async installGit(source: string, skillPath: string, expectedSourceRevision: string, allowUnsupportedFiles = false): Promise<{ status: "ok"; skillId: string; revision: string }> {
        if (!REVISION.test(expectedSourceRevision)) throw new LocalSkillsProviderError("not_found");
        try {
            const raw = await this.github.installSource(source, skillPath, expectedSourceRevision, allowUnsupportedFiles);
            const normalizedSource = `https://github.com/${new URL(source).pathname.split("/").filter(Boolean).slice(0, 2).join("/")}`;
            return await this.installMarkdown(raw, normalizedSource);
        } catch (error) {
            throw this.providerError(error);
        }
    }

    async create(draft: SkillDraft, source = "local"): Promise<{ status: "ok"; skillId: string; revision: string }> {
        const content = markdownFor(draft);
        const root = await this.ensureRoot();
        return this.withLock(draft.skillId, async () => {
            const dir = path.join(root, draft.skillId);
            try {
                await fs.promises.mkdir(dir, { mode: 0o700 });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Já existe uma skill com esse identificador.");
                throw error;
            }
            try {
                await this.atomicWrite(path.join(dir, "SKILL.md"), content);
                await this.writeState(dir, { enabled: true, source: this.safeSource(source) });
            } catch (error) {
                await fs.promises.rm(dir, { recursive: true, force: true });
                throw error;
            }
            return { status: "ok", skillId: draft.skillId, revision: this.revision(content) };
        });
    }

    async installMarkdown(content: string, source: string): Promise<{ status: "ok"; skillId: string; revision: string }> {
        const draft = parseMarkdown(content);
        return this.create(draft, source);
    }

    async inspect(skillId: string, revision: string): Promise<{ status: "ok"; skillId: string; revision: string; description: string; instructions: string; source: string; enabled: boolean }> {
        const metadata = await this.current(skillId, revision);
        const loaded = await super.load(skillId, revision);
        const dir = await this.skillDirectory(skillId);
        const state = await this.readState(dir);
        return { status: "ok", skillId, revision, description: metadata.description, instructions: loaded.content, source: state.source, enabled: state.enabled };
    }

    async edit(draft: SkillDraft & { revision: string }): Promise<{ status: "ok"; skillId: string; revision: string }> {
        const content = markdownFor(draft);
        return this.withLock(draft.skillId, async () => {
            await this.current(draft.skillId, draft.revision);
            const dir = await this.skillDirectory(draft.skillId);
            const latest = (await super.list()).find((skill) => skill.skillId === draft.skillId);
            if (latest?.revision !== draft.revision) throw new LocalSkillsProviderError("stale_revision", "A skill foi alterada; atualize antes de salvar.");
            const state = await this.readState(dir);
            await this.atomicWrite(path.join(dir, "SKILL.md"), content);
            await this.writeState(dir, state);
            return { status: "ok", skillId: draft.skillId, revision: this.revision(content) };
        });
    }

    async setEnabled(skillId: string, revision: string, enabled: boolean): Promise<{ status: "ok"; skillId: string; revision: string; enabled: boolean }> {
        if (typeof enabled !== "boolean") throw new LocalSkillsProviderError("not_found", "Estado de habilitação inválido.");
        return this.withLock(skillId, async () => {
            await this.current(skillId, revision);
            const dir = await this.skillDirectory(skillId);
            const state = await this.readState(dir);
            await this.writeState(dir, { ...state, enabled });
            return { status: "ok", skillId, revision, enabled };
        });
    }

    async remove(skillId: string, revision: string, confirmed: boolean): Promise<{ status: "ok"; skillId: string }> {
        if (!confirmed) throw new Error("É necessária confirmação para remover a skill.");
        return this.withLock(skillId, async () => {
            await this.current(skillId, revision);
            const dir = await this.skillDirectory(skillId);
            const entries = await fs.promises.readdir(dir);
            if (entries.some((entry) => entry !== "SKILL.md" && entry !== ".helena-state.json")) {
                throw new LocalSkillsProviderError("unavailable", "A pasta contém arquivos não gerenciados; remoção recusada.");
            }
            for (const entry of entries) {
                const file = path.join(dir, entry);
                const stat = await fs.promises.lstat(file);
                if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
                    throw new LocalSkillsProviderError("unavailable", "Arquivo especial na pasta; remoção recusada.");
                }
                await fs.promises.unlink(file);
            }
            await fs.promises.rmdir(dir);
            return { status: "ok", skillId };
        });
    }

    override async list(): Promise<LocalSkillMetadata[]> {
        const skills = await super.list();
        if (skills.length === 0) return skills;
        const root = await this.ensureRoot();
        return Promise.all(skills.map(async (skill) => {
            const state = await this.readState(path.join(root, skill.skillId));
            return { ...skill, enabled: state.enabled, source: state.source };
        }));
    }

    override async load(skillId: string, revision: string): Promise<{ revision: string; content: string }> {
        const skill = (await this.list()).find((entry) => entry.skillId === skillId);
        if (!skill) throw new LocalSkillsProviderError("not_found");
        if (!skill.enabled) throw new LocalSkillsProviderError("disabled");
        if (skill.revision !== revision) throw new LocalSkillsProviderError("stale_revision");
        return super.load(skillId, revision);
    }

    private async current(skillId: string, revision: string): Promise<LocalSkillMetadata> {
        if (!SKILL_ID.test(skillId) || !REVISION.test(revision)) throw new LocalSkillsProviderError("not_found");
        const current = (await super.list()).find((skill) => skill.skillId === skillId);
        if (!current) throw new LocalSkillsProviderError("not_found");
        if (current.revision !== revision) throw new LocalSkillsProviderError("stale_revision");
        return current;
    }

    private async ensureRoot(): Promise<string> {
        await fs.promises.mkdir(path.dirname(this.configuredRoot), { recursive: true, mode: 0o700 });
        try {
            await fs.promises.mkdir(this.configuredRoot, { mode: 0o700 });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const stat = await fs.promises.lstat(this.configuredRoot);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new LocalSkillsProviderError("unavailable");
        return fs.realpathSync(this.configuredRoot);
    }

    private async skillDirectory(skillId: string): Promise<string> {
        if (!SKILL_ID.test(skillId) || skillId.length > MAX_ID_LENGTH) throw new LocalSkillsProviderError("not_found");
        const root = await this.ensureRoot();
        const dir = path.join(root, skillId);
        const stat = await fs.promises.lstat(dir).catch(() => undefined);
        if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new LocalSkillsProviderError("not_found");
        if (await fs.promises.realpath(dir) !== dir) throw new LocalSkillsProviderError("unavailable");
        return dir;
    }

    private async readState(dir: string): Promise<SkillState> {
        const file = path.join(dir, ".helena-state.json");
        try {
            const stat = await fs.promises.lstat(file);
            if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) throw new Error();
            const parsed = JSON.parse(await fs.promises.readFile(file, "utf8")) as Record<string, unknown>;
            return { enabled: parsed.enabled !== false, source: typeof parsed.source === "string" ? parsed.source : "local" };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return { enabled: true, source: "local" };
            throw new LocalSkillsProviderError("unavailable");
        }
    }

    private async writeState(dir: string, state: SkillState): Promise<void> {
        await this.atomicWrite(path.join(dir, ".helena-state.json"), JSON.stringify(state));
    }

    private async atomicWrite(file: string, content: string): Promise<void> {
        const tmp = path.join(path.dirname(file), `.helena-${process.pid}-${cryptoRandom()}.tmp`);
        const handle = await fs.promises.open(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
        try {
            await handle.writeFile(content, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        try {
            const parent = await fs.promises.lstat(path.dirname(file));
            if (parent.isSymbolicLink() || !parent.isDirectory()) throw new LocalSkillsProviderError("unavailable");
            await fs.promises.rename(tmp, file);
        } catch (error) {
            await fs.promises.unlink(tmp).catch(() => undefined);
            throw error;
        }
    }

    private revision(content: string): string {
        return `sha256:${createHash("sha256").update(content).digest("hex")}`;
    }

    private safeSource(source: string): string {
        return source === "local-file" || isSupportedGitSource(source)
            ? source
            : "local";
    }

    private catalogResult(catalog: GitHubSkillCatalog): Record<string, unknown> {
        return {
            kind: "catalog",
            source: catalog.source,
            ref: catalog.ref,
            commit: catalog.commit,
            skills: catalog.skills,
        };
    }

    private providerError(error: unknown): LocalSkillsProviderError {
        if (error instanceof LocalSkillsProviderError) return error;
        if (error instanceof GitHubSkillImportError) {
            if (error.code === "incompatible_skill") return new LocalSkillsProviderError("incompatible_skill", error.message);
            if (error.code === "unsupported_files") return new LocalSkillsProviderError("unsupported_files", error.message);
            if (error.code === "network") return new LocalSkillsProviderError("network", error.message);
            if (error.code === "invalid_source") return new LocalSkillsProviderError("invalid_source", error.message);
            if (error.code === "payload_too_large") return new LocalSkillsProviderError("payload_too_large", error.message);
            return new LocalSkillsProviderError("not_found", error.message);
        }
        return new LocalSkillsProviderError("unavailable", "Não foi possível concluir a importação do GitHub.");
    }

    private async withLock<T>(skillId: string, operation: () => Promise<T>): Promise<T> {
        if (this.locks.has(skillId)) throw new LocalSkillsProviderError("stale_revision", "A skill está sendo alterada em outra operação.");
        this.locks.add(skillId);
        try { return await operation(); }
        finally { this.locks.delete(skillId); }
    }
}

function isSupportedGitSource(value: string): boolean {
    try {
        parseGitHubSkillSource(value);
        return true;
    } catch {
        return false;
    }
}

function cryptoRandom(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
