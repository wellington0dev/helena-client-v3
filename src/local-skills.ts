import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { configDir } from "./local-api/paths.ts";
import {
    LocalSkillsProviderError,
    MAX_LOCAL_SKILL_CONTENT_BYTES,
    MAX_LOCAL_SKILLS_COUNT,
    type LocalSkillMetadata,
    type LocalSkillsProvider,
} from "./local-skills-protocol.ts";

export const LOCAL_SKILLS_DIRECTORY_NAME = "skills";
export const MAX_LOCAL_SKILL_FILE_BYTES = MAX_LOCAL_SKILL_CONTENT_BYTES;
export const MAX_LOCAL_SKILL_FRONTMATTER_BYTES = 8 * 1024;
/** Bounds directory enumeration even when the root contains arbitrary non-skill entries. */
export const MAX_LOCAL_SKILL_DIRECTORY_ENTRIES = 2_048;

const SKILL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION = /^sha256:[a-f0-9]{64}$/;
const ALLOWED_FRONTMATTER_FIELDS = new Set(["name", "description", "license", "compatibility", "allowed-tools", "metadata"]);

export interface ParsedSkill {
    name: string;
    description: string;
    instructions: string;
}

interface RootSnapshot {
    configuredPath: string;
    canonicalPath: string;
    stat: fs.BigIntStats;
}

export class InvalidSkillFile extends Error {
    readonly reason: string;

    constructor(reason: string) {
        super(reason);
        this.reason = reason;
    }
}

function sameIdentity(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
    return left.dev === right.dev && left.ino !== 0n && left.ino === right.ino;
}

function sameSnapshot(left: fs.BigIntStats, right: fs.BigIntStats): boolean {
    return sameIdentity(left, right)
        && left.size === right.size
        && left.mtimeNs === right.mtimeNs
        && left.ctimeNs === right.ctimeNs
        && left.nlink === right.nlink;
}

function isMissing(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isUnavailableSkillRead(error: unknown): boolean {
    return error instanceof InvalidSkillFile
        && (error.reason === "directory_unavailable" || error.reason === "skill_file_unavailable");
}

function byteLength(value: string): number {
    return Buffer.byteLength(value, "utf8");
}

async function readBounded(handle: fs.promises.FileHandle): Promise<Buffer> {
    const buffer = Buffer.alloc(MAX_LOCAL_SKILL_FILE_BYTES + 1);
    let total = 0;
    while (total < buffer.byteLength) {
        const { bytesRead } = await handle.read(buffer, total, buffer.byteLength - total, total);
        if (bytesRead === 0) break;
        total += bytesRead;
    }
    if (total > MAX_LOCAL_SKILL_FILE_BYTES) throw new InvalidSkillFile("skill_file_too_large");
    return buffer.subarray(0, total);
}

function safeWarning(reason: string): void {
    // Do not log user-controlled names, file paths, or skill contents.
    console.warn(`[local-skills] entrada ignorada (${reason}).`);
}

function parseScalar(rawValue: string): string {
    const trimmed = rawValue.trim();
    if (!trimmed) throw new InvalidSkillFile("empty_scalar");
    if (trimmed.startsWith('"')) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (typeof parsed !== "string") throw new Error();
            return parsed;
        } catch {
            throw new InvalidSkillFile("invalid_quoted_scalar");
        }
    }
    if (trimmed.startsWith("'")) {
        if (!/^'(?:[^']|'')*'$/.test(trimmed)) throw new InvalidSkillFile("invalid_quoted_scalar");
        return trimmed.slice(1, -1).replace(/''/g, "'");
    }
    if (/^[>|[{&*!]/.test(trimmed)) throw new InvalidSkillFile("unsupported_yaml_value");
    return trimmed.replace(/[ \t]+#.*$/, "").trim();
}

function parseSkillFile(skillId: string, bytes: Buffer): ParsedSkill {
    let decoded: string;
    try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw new InvalidSkillFile("invalid_utf8");
    }
    const normalized = decoded.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    if (!normalized.startsWith("---\n")) throw new InvalidSkillFile("frontmatter_missing");

    const closing = normalized.indexOf("\n---\n", 4);
    const closingAtEof = closing < 0 ? normalized.indexOf("\n---", 4) : -1;
    const end = closing >= 0 ? closing : closingAtEof;
    if (end < 0) throw new InvalidSkillFile("frontmatter_incomplete");
    const delimiterLength = closing >= 0 ? 5 : 4;
    const frontmatter = normalized.slice(4, end);
    if (byteLength(frontmatter) > MAX_LOCAL_SKILL_FRONTMATTER_BYTES) throw new InvalidSkillFile("frontmatter_too_large");

    const fields = new Map<string, string>();
    const metadataKeys = new Set<string>();
    let inMetadata = false;
    for (const line of frontmatter.split("\n")) {
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        if (inMetadata && line.startsWith("  ")) {
            const metadataMatch = /^  ([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
            if (!metadataMatch || metadataKeys.has(metadataMatch[1]!)) throw new InvalidSkillFile("invalid_metadata");
            parseScalar(metadataMatch[2]!);
            metadataKeys.add(metadataMatch[1]!);
            continue;
        }
        inMetadata = false;
        if (/^\s/.test(line)) throw new InvalidSkillFile("invalid_frontmatter_indentation");
        const match = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(line);
        if (!match) throw new InvalidSkillFile("invalid_frontmatter_field");
        const [, key, rawValue] = match;
        if (!ALLOWED_FRONTMATTER_FIELDS.has(key!)) throw new InvalidSkillFile(`unsupported_metadata:${key}`);
        if (fields.has(key!)) throw new InvalidSkillFile(`duplicate_frontmatter_field:${key}`);
        if (key === "metadata") {
            if (rawValue!.trim()) throw new InvalidSkillFile("invalid_metadata");
            fields.set(key, "");
            inMetadata = true;
        } else {
            fields.set(key!, parseScalar(rawValue!));
        }
    }

    const name = fields.get("name");
    const description = fields.get("description");
    if (!name || !SKILL_ID.test(name) || name.length > 64 || (skillId !== "" && name !== skillId)) throw new InvalidSkillFile("invalid_name");
    if (!description || description.trim().length === 0 || byteLength(description) > 1_024) throw new InvalidSkillFile("invalid_description");

    const bodyStart = end + delimiterLength;
    const instructions = normalized.slice(bodyStart).trim();
    if (!instructions) throw new InvalidSkillFile("empty_body");
    if (byteLength(instructions) > MAX_LOCAL_SKILL_CONTENT_BYTES) throw new InvalidSkillFile("content_too_large");
    return { name, description, instructions };
}

/** Validates imported Markdown with the exact same restrictions as a local catalog entry. */
export function parseLocalSkillMarkdown(content: string): ParsedSkill {
    if (typeof content !== "string") throw new InvalidSkillFile("invalid_utf8");
    const bytes = Buffer.from(content, "utf8");
    if (bytes.byteLength > MAX_LOCAL_SKILL_FILE_BYTES) throw new InvalidSkillFile("skill_file_too_large");
    return parseSkillFile("", bytes);
}

function contained(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/**
 * Read-only local catalog. The root is selected by trusted application code,
 * not by a protocol payload. Nothing is created and no file body is cached.
 */
export class LocalSkillsCatalog implements LocalSkillsProvider {
    private readonly rootPath: string;

    constructor(rootPath: string) {
        this.rootPath = path.resolve(rootPath);
    }

    async list(): Promise<LocalSkillMetadata[]> {
        const root = await this.rootSnapshot();
        if (!root) return [];

        let directory: fs.Dir;
        try {
            directory = await fs.promises.opendir(root.canonicalPath);
        } catch {
            throw new LocalSkillsProviderError("unavailable");
        }

        const skills: LocalSkillMetadata[] = [];
        const seen = new Set<string>();
        let entries = 0;
        try {
            for await (const entry of directory) {
                entries++;
                if (entries > MAX_LOCAL_SKILL_DIRECTORY_ENTRIES) {
                    throw new LocalSkillsProviderError("payload_too_large");
                }
                if (!SKILL_ID.test(entry.name)) {
                    if (entry.isDirectory() || entry.isSymbolicLink()) safeWarning("invalid_directory_id");
                    continue;
                }

                try {
                    const skill = await this.readSkill(root, entry.name);
                    if (!skill) continue;
                    if (seen.has(skill.metadata.skillId)) {
                        safeWarning("duplicate_skill_id");
                        continue;
                    }
                    seen.add(skill.metadata.skillId);
                    skills.push(skill.metadata);
                    if (skills.length > MAX_LOCAL_SKILLS_COUNT) {
                        throw new LocalSkillsProviderError("payload_too_large");
                    }
                } catch (error) {
                    if (error instanceof LocalSkillsProviderError) throw error;
                    safeWarning(error instanceof InvalidSkillFile ? error.reason : "unreadable_skill");
                }
            }
        } catch (error) {
            if (error instanceof LocalSkillsProviderError) throw error;
            throw new LocalSkillsProviderError("unavailable");
        }
        await this.assertRootUnchanged(root);
        return skills.sort((left, right) => left.skillId < right.skillId ? -1 : left.skillId > right.skillId ? 1 : 0);
    }

    async load(skillId: string, revision: string): Promise<{ revision: string; content: string }> {
        if (!SKILL_ID.test(skillId) || skillId.length > 64 || !REVISION.test(revision)) {
            throw new LocalSkillsProviderError("not_found");
        }
        const root = await this.rootSnapshot();
        if (!root) throw new LocalSkillsProviderError("not_found");

        let skill: Awaited<ReturnType<LocalSkillsCatalog["readSkill"]>>;
        try {
            skill = await this.readSkill(root, skillId);
        } catch (error) {
            if (error instanceof LocalSkillsProviderError) throw error;
            if (isUnavailableSkillRead(error)) throw new LocalSkillsProviderError("unavailable");
            if (error instanceof InvalidSkillFile || isMissing(error)) throw new LocalSkillsProviderError("stale_revision");
            throw new LocalSkillsProviderError("unavailable");
        }
        if (!skill) throw new LocalSkillsProviderError("not_found");
        if (skill.metadata.revision !== revision) throw new LocalSkillsProviderError("stale_revision");
        await this.assertRootUnchanged(root);
        return { revision: skill.metadata.revision, content: skill.instructions };
    }

    private async rootSnapshot(): Promise<RootSnapshot | undefined> {
        let stat: fs.BigIntStats;
        try {
            stat = await fs.promises.lstat(this.rootPath, { bigint: true });
        } catch (error) {
            if (isMissing(error)) return undefined;
            throw new LocalSkillsProviderError("unavailable");
        }
        if (stat.isSymbolicLink() || !stat.isDirectory() || stat.ino === 0n) {
            throw new LocalSkillsProviderError("unavailable");
        }
        try {
            const canonicalPath = await fs.promises.realpath(this.rootPath);
            const canonicalStat = await fs.promises.lstat(canonicalPath, { bigint: true });
            if (!sameIdentity(stat, canonicalStat)) {
                throw new LocalSkillsProviderError("unavailable");
            }
            return { configuredPath: this.rootPath, canonicalPath, stat };
        } catch (error) {
            if (error instanceof LocalSkillsProviderError) throw error;
            throw new LocalSkillsProviderError("unavailable");
        }
    }

    private async assertRootUnchanged(root: RootSnapshot): Promise<void> {
        try {
            const current = await fs.promises.lstat(root.configuredPath, { bigint: true });
            const canonical = await fs.promises.realpath(root.configuredPath);
            if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(root.stat, current) || canonical !== root.canonicalPath) {
                throw new LocalSkillsProviderError("unavailable");
            }
        } catch (error) {
            if (error instanceof LocalSkillsProviderError) throw error;
            throw new LocalSkillsProviderError("unavailable");
        }
    }

    private async readSkill(root: RootSnapshot, skillId: string): Promise<{
        metadata: LocalSkillMetadata;
        instructions: string;
    } | undefined> {
        const directoryPath = path.join(root.canonicalPath, skillId);
        let directoryStat: fs.BigIntStats;
        try {
            directoryStat = await fs.promises.lstat(directoryPath, { bigint: true });
        } catch (error) {
            if (isMissing(error)) return undefined;
            throw new InvalidSkillFile("directory_unavailable");
        }
        if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || directoryStat.ino === 0n) {
            throw new InvalidSkillFile("invalid_skill_directory");
        }
        const realDirectory = await fs.promises.realpath(directoryPath).catch(() => "");
        if (realDirectory !== directoryPath || !contained(root.canonicalPath, realDirectory)) {
            throw new InvalidSkillFile("directory_outside_root");
        }

        const filePath = path.join(directoryPath, "SKILL.md");
        let fileStat: fs.BigIntStats;
        try {
            fileStat = await fs.promises.lstat(filePath, { bigint: true });
        } catch (error) {
            if (isMissing(error)) return undefined;
            throw new InvalidSkillFile("skill_file_unavailable");
        }
        if (fileStat.isSymbolicLink() || !fileStat.isFile() || fileStat.ino === 0n || fileStat.nlink !== 1n) {
            throw new InvalidSkillFile("invalid_skill_file_type");
        }
        if (fileStat.size > BigInt(MAX_LOCAL_SKILL_FILE_BYTES)) throw new InvalidSkillFile("skill_file_too_large");
        const realFile = await fs.promises.realpath(filePath).catch(() => "");
        if (realFile !== filePath || !contained(directoryPath, realFile)) throw new InvalidSkillFile("skill_file_outside_root");

        const noFollow = fs.constants.O_NOFOLLOW ?? 0;
        let handle: fs.promises.FileHandle | undefined;
        try {
            handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | noFollow);
            const openedStat = await handle.stat({ bigint: true });
            if (!openedStat.isFile() || openedStat.nlink !== 1n || !sameSnapshot(fileStat, openedStat)) {
                throw new InvalidSkillFile("skill_file_changed_during_open");
            }
            const bytes = await readBounded(handle);
            const afterRead = await handle.stat({ bigint: true });
            if (!sameSnapshot(openedStat, afterRead)) throw new InvalidSkillFile("skill_file_changed_during_read");
            const [currentFile, currentDirectory, currentRoot, currentRealFile] = await Promise.all([
                fs.promises.lstat(filePath, { bigint: true }),
                fs.promises.lstat(directoryPath, { bigint: true }),
                fs.promises.lstat(root.configuredPath, { bigint: true }),
                fs.promises.realpath(filePath),
            ]);
            if (currentFile.isSymbolicLink() || !sameIdentity(afterRead, currentFile)
                || currentDirectory.isSymbolicLink() || !sameIdentity(directoryStat, currentDirectory)
                || currentRoot.isSymbolicLink() || !sameIdentity(root.stat, currentRoot)
                || currentRealFile !== filePath) {
                throw new InvalidSkillFile("skill_path_changed_during_read");
            }

            const parsed = parseSkillFile(skillId, bytes);
            const revision = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
            return {
                metadata: { skillId, name: parsed.name, description: parsed.description, revision, enabled: true },
                instructions: parsed.instructions,
            };
        } finally {
            await handle?.close();
        }
    }
}

export function createLocalSkillsProvider(): LocalSkillsCatalog {
    return new LocalSkillsCatalog(path.join(configDir(), LOCAL_SKILLS_DIRECTORY_NAME));
}
