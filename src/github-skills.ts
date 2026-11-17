import { createHash } from "node:crypto";
import {
    MAX_LOCAL_SKILL_CONTENT_BYTES,
} from "./local-skills-protocol.ts";
import { InvalidSkillFile, parseLocalSkillMarkdown } from "./local-skills.ts";

const API = "https://api.github.com";
const MAX_API_BODY_BYTES = 5 * 1024 * 1024;
const MAX_SKILLS = 250;
const MAX_BRANCH_PAGES = 10;
const MAX_DISCOVERY_MARKDOWN_BYTES = 1024 * 1024;
const SHA = /^[a-f0-9]{40,64}$/i;

export interface ParsedGitHubSkillSource {
    owner: string;
    repo: string;
    /** Unresolved path following tree/blob/raw; branches may themselves contain slashes. */
    locator?: string[];
}

export interface GitHubSkillCandidate {
    skillPath: string;
    skillId: string;
    description: string;
    revision: string;
    compatible: boolean;
    incompatibility?: string;
    unsupportedFiles: string[];
}

export interface GitHubSkillCatalog {
    source: string;
    ref: string;
    commit: string;
    skills: GitHubSkillCandidate[];
}

export interface GitHubSkillFile extends GitHubSkillCandidate {
    source: string;
    sourceRevision: string;
    instructions: string;
    markdown: string;
}

interface TreeEntry {
    path: string;
    type: string;
    sha: string;
    size?: number;
}

export class GitHubSkillImportError extends Error {
    readonly code: "invalid_source" | "not_found" | "network" | "payload_too_large" | "incompatible_skill" | "unsupported_files";

    constructor(
        code: "invalid_source" | "not_found" | "network" | "payload_too_large" | "incompatible_skill" | "unsupported_files",
        message: string,
    ) {
        super(message);
        this.name = "GitHubSkillImportError";
        this.code = code;
    }
}

function decodeSegments(pathname: string): string[] {
    const rawSegments = pathname.split("/").filter(Boolean);
    const segments = rawSegments.map((segment) => {
        let decoded: string;
        try { decoded = decodeURIComponent(segment); }
        catch { throw invalidSource(); }
        if (!decoded || decoded === "." || decoded === ".." || /[\\/\u0000-\u001f\u007f]/.test(decoded)) throw invalidSource();
        return decoded;
    });
    return segments;
}

function invalidSource(): GitHubSkillImportError {
    return new GitHubSkillImportError("invalid_source", "Use uma URL HTTPS válida do GitHub, sem credenciais nem caminhos maliciosos.");
}

export function parseGitHubSkillSource(value: string): ParsedGitHubSkillSource {
    if (typeof value !== "string" || value.length > 2_048 || /%(?:2f|5c)/i.test(value)) throw invalidSource();
    const rawPath = value.match(/^https:\/\/[^/?#]+([^?#]*)/i)?.[1] ?? "";
    if (rawPath.split("/").some((segment) => {
        try { const decoded = decodeURIComponent(segment); return decoded === "." || decoded === ".."; }
        catch { return true; }
    })) throw invalidSource();
    let url: URL;
    try { url = new URL(value); }
    catch { throw invalidSource(); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) throw invalidSource();
    const hostname = url.hostname.toLowerCase();
    const segments = decodeSegments(url.pathname);
    if (hostname === "github.com") {
        if (segments.length < 2) throw invalidSource();
        const owner = segments[0]!;
        const repo = segments[1]!.replace(/\.git$/i, "");
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) throw invalidSource();
        if (segments.length === 2) return { owner, repo };
        if (segments[2] === "tree") {
            if (segments.length < 4) throw invalidSource();
            return { owner, repo, locator: segments.slice(3) };
        }
        if (segments[2] === "blob") {
            const locator = segments.slice(3);
            if (locator.length < 2 || locator.at(-1) !== "SKILL.md") throw invalidSource();
            return { owner, repo, locator };
        }
        if (segments.length === 3 && segments[2] === "") return { owner, repo };
        throw invalidSource();
    }
    if (hostname === "raw.githubusercontent.com") {
        if (segments.length < 4 || segments.at(-1) !== "SKILL.md") throw invalidSource();
        const [owner, repo, ...locator] = segments;
        if (!owner || !repo || locator.length < 2) throw invalidSource();
        const normalizedRepo = repo.replace(/\.git$/i, "");
        if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(normalizedRepo)) throw invalidSource();
        return { owner, repo: normalizedRepo, locator };
    }
    throw invalidSource();
}

async function readBounded(response: Response, limit: number): Promise<Uint8Array> {
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) {
                await reader.cancel();
                throw new GitHubSkillImportError("payload_too_large", "A resposta do GitHub excede o limite de tamanho.");
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
    return output;
}

export class GitHubSkillImporter {
    private readonly fetcher: typeof fetch;
    constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher; }

    async discover(source: string): Promise<GitHubSkillCatalog> {
        const parsed = parseGitHubSkillSource(source);
        const repo = await this.apiJson<{ default_branch?: string }>(`/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`);
        const branches = await this.listBranches(parsed.owner, parsed.repo);
        const selected = this.resolveLocator(parsed.locator, branches, repo.default_branch);
        if (!selected.ref) throw new GitHubSkillImportError("not_found", "Não foi possível localizar a branch ou o commit informado.");
        const branch = branches.find((item) => item.name === selected.ref);
        const commit = branch?.commit.sha ?? (SHA.test(selected.ref) ? selected.ref : undefined);
        if (!commit || !SHA.test(commit)) throw new GitHubSkillImportError("not_found", "A branch ou commit do GitHub não foi encontrado.");

        const tree = await this.apiJson<{ truncated?: boolean; tree?: TreeEntry[] }>(
            `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(commit)}?recursive=1`,
        );
        if (!Array.isArray(tree.tree) || tree.truncated) {
            throw new GitHubSkillImportError("payload_too_large", "O repositório é grande demais para descobrir skills com segurança.");
        }
        const treeEntries = tree.tree;
        const skillFiles = treeEntries.filter((entry) => entry.type === "blob" && (entry.path.endsWith("/SKILL.md") || entry.path === "SKILL.md"));
        if (skillFiles.some((entry) => entry.path.length > 512 || entry.path.split("/").some((part) => !part || part === "." || part === ".." || /[\\\u0000-\u001f\u007f]/.test(part)))) {
            throw new GitHubSkillImportError("invalid_source", "O repositório contém um caminho de SKILL.md inválido ou acima do limite.");
        }
        const scopedFiles = selected.path
            ? skillFiles.filter((entry) => entry.path === `${selected.path}/SKILL.md` || entry.path.startsWith(`${selected.path}/`))
            : skillFiles;
        if (scopedFiles.length > MAX_SKILLS) throw new GitHubSkillImportError("payload_too_large", `Foram encontradas mais de ${MAX_SKILLS} skills. Informe a URL de uma pasta para limitar a descoberta.`);
        const candidates: GitHubSkillCandidate[] = [];
        let discoveryBytes = 0;
        for (let offset = 0; offset < scopedFiles.length; offset += 6) {
            const batch = await Promise.all(scopedFiles.slice(offset, offset + 6).map(async (entry) => {
                if (!SHA.test(entry.sha) || (entry.size !== undefined && entry.size > MAX_LOCAL_SKILL_CONTENT_BYTES)
                    || entry.path.split("/").some((part) => part === "." || part === ".." || /[\\\u0000-\u001f]/.test(part))) {
                    return this.incompatibleCandidate(entry.path, "SKILL.md excede 32 KB ou tem um caminho inválido.");
                }
                const content = await this.readRawFile(parsed.owner, parsed.repo, commit, entry.path);
                const skillPath = entry.path === "SKILL.md" ? "" : entry.path.slice(0, -"/SKILL.md".length);
                const allUnsupportedFiles = treeEntries
                    .filter((item) => item.type === "blob" && skillPath !== "" && item.path.startsWith(`${skillPath}/`) && item.path !== entry.path)
                    .map((item) => item.path.slice(skillPath.length + 1));
                const unsupportedFiles = allUnsupportedFiles.length > 20
                    ? [...allUnsupportedFiles.slice(0, 19), `… e mais ${allUnsupportedFiles.length - 19} arquivo(s) auxiliar(es)`]
                    : allUnsupportedFiles;
                return this.candidate(entry.path, content, unsupportedFiles);
            }));
            for (const candidate of batch) {
                discoveryBytes += Buffer.byteLength(candidate.description, "utf8");
                if (discoveryBytes > MAX_DISCOVERY_MARKDOWN_BYTES) throw new GitHubSkillImportError("payload_too_large", "O catálogo de skills excede o limite de descoberta.");
                candidates.push(candidate);
            }
        }
        return {
            source: `https://github.com/${parsed.owner}/${parsed.repo}/tree/${selected.ref.split("/").map(encodeURIComponent).join("/")}`,
            ref: selected.ref,
            commit,
            skills: candidates,
        };
    }

    async preview(source: string, skillPath: string): Promise<GitHubSkillFile> {
        if (typeof skillPath !== "string" || skillPath.length > 512 || skillPath.split("/").some((part) => !part || part === "." || part === ".." || /[\\\u0000-\u001f]/.test(part))) {
            throw invalidSource();
        }
        const catalog = await this.discover(source);
        const candidate = catalog.skills.find((item) => item.skillPath === skillPath);
        if (!candidate) throw new GitHubSkillImportError("not_found", "A skill selecionada não foi encontrada nessa revisão do repositório.");
        if (!candidate.compatible) throw new GitHubSkillImportError("incompatible_skill", candidate.incompatibility ?? "O arquivo SKILL.md não é compatível.");
        const parsed = parseGitHubSkillSource(source);
        const filePath = skillPath ? `${skillPath}/SKILL.md` : "SKILL.md";
        const fileEntry = await this.findTreeEntry(parsed.owner, parsed.repo, catalog.commit, filePath);
        const markdown = await this.readRawFile(parsed.owner, parsed.repo, catalog.commit, fileEntry.path);
        const instructions = markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)([\s\S]*)$/)?.[1]?.trim() ?? "";
        const sourceRevision = `sha256:${createHash("sha256").update(`${catalog.commit}\0${filePath}\0${markdown}`).digest("hex")}`;
        const encodedSkillPath = skillPath ? `/${skillPath.split("/").map(encodeURIComponent).join("/")}` : "";
        return {
            ...candidate,
            source: `https://github.com/${parsed.owner}/${parsed.repo}/tree/${catalog.ref.split("/").map(encodeURIComponent).join("/")}${encodedSkillPath}`,
            sourceRevision,
            instructions,
            markdown,
        };
    }

    async installSource(source: string, skillPath: string, expectedRevision: string, allowUnsupportedFiles = false): Promise<string> {
        const preview = await this.preview(source, skillPath);
        if (preview.unsupportedFiles.length && !allowUnsupportedFiles) {
            throw new GitHubSkillImportError("unsupported_files", `Esta skill depende ou contém arquivos auxiliares não instalados pelo Helena: ${preview.unsupportedFiles.join(", ")}.`);
        }
        if (preview.sourceRevision !== expectedRevision) {
            throw new GitHubSkillImportError("not_found", "A skill mudou desde a prévia. Faça uma nova prévia antes de instalar.");
        }
        return preview.markdown;
    }

    private resolveLocator(locator: string[] | undefined, branches: Array<{ name: string; commit: { sha: string } }>, defaultBranch?: string): { ref?: string; path: string } {
        if (!locator) return { ref: defaultBranch, path: "" };
        if (SHA.test(locator[0]!)) {
            const tail = locator.slice(1).join("/");
            const path = tail.endsWith("/SKILL.md") ? tail.slice(0, -"/SKILL.md".length) : tail === "SKILL.md" ? "" : tail;
            return { ref: locator[0], path };
        }
        const matches = branches
            .filter((branch) => locator.length > branch.name.split("/").length && locator.slice(0, branch.name.split("/").length).join("/") === branch.name)
            .sort((a, b) => b.name.length - a.name.length);
        if (!matches.length) {
            const exact = branches.find((branch) => branch.name === locator.join("/"));
            if (exact) return { ref: exact.name, path: "" };
            throw new GitHubSkillImportError("not_found", "Branch ou caminho não encontrado no GitHub.");
        }
        const ref = matches[0]!.name;
        const skillPath = locator.slice(ref.split("/").length).join("/");
        const fileTarget = skillPath.endsWith("/SKILL.md") ? skillPath.slice(0, -"/SKILL.md".length) : skillPath === "SKILL.md" ? "" : skillPath;
        return { ref, path: fileTarget };
    }

    private async listBranches(owner: string, repo: string): Promise<Array<{ name: string; commit: { sha: string } }>> {
        const branches: Array<{ name: string; commit: { sha: string } }> = [];
        for (let page = 1; page <= MAX_BRANCH_PAGES; page++) {
            const batch = await this.apiJson<Array<{ name: string; commit: { sha: string } }>>(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100&page=${page}`,
            );
            if (!Array.isArray(batch) || batch.some((item) => typeof item.name !== "string" || !item.commit || !SHA.test(item.commit.sha))) {
                throw new GitHubSkillImportError("network", "O GitHub retornou uma lista de branches inválida.");
            }
            branches.push(...batch);
            if (batch.length < 100) return branches;
        }
        throw new GitHubSkillImportError("payload_too_large", "O repositório tem branches demais para resolver a URL sem ambiguidade.");
    }

    private async findTreeEntry(owner: string, repo: string, commit: string, path: string): Promise<TreeEntry> {
        const tree = await this.apiJson<{ truncated?: boolean; tree?: TreeEntry[] }>(
            `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(commit)}?recursive=1`,
        );
        const entry = tree.tree?.find((item) => item.path === path && item.type === "blob");
        if (!entry || !SHA.test(entry.sha)) throw new GitHubSkillImportError("not_found", "SKILL.md não encontrado na revisão selecionada.");
        if (entry.size !== undefined && entry.size > MAX_LOCAL_SKILL_CONTENT_BYTES) throw new GitHubSkillImportError("payload_too_large", "SKILL.md excede o limite de 32 KB.");
        return entry;
    }

    private async readRawFile(owner: string, repo: string, commit: string, filePath: string): Promise<string> {
        const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
        const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(commit)}/${encodedPath}`;
        let response: Response;
        try {
            response = await this.fetcher(url, {
                headers: { Accept: "text/plain", "User-Agent": "Helena-Client" },
                redirect: "manual",
                signal: AbortSignal.timeout(15_000),
            });
        } catch {
            throw new GitHubSkillImportError("network", "Falha de rede ao baixar SKILL.md. Tente novamente.");
        }
        if (response.status >= 300 && response.status < 400) throw new GitHubSkillImportError("network", "O GitHub respondeu com um redirecionamento não permitido.");
        if (response.status === 404 || response.status === 401 || response.status === 403) {
            throw new GitHubSkillImportError("not_found", "Repositório não encontrado ou privado/sem acesso público.");
        }
        if (!response.ok) throw new GitHubSkillImportError("network", "Falha ao baixar SKILL.md do GitHub. Tente novamente.");
        const bytes = await readBounded(response, MAX_LOCAL_SKILL_CONTENT_BYTES);
        try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { throw new GitHubSkillImportError("incompatible_skill", "SKILL.md não está codificado como UTF-8 válido."); }
    }

    private candidate(path: string, content: string, unsupportedFiles: string[]): GitHubSkillCandidate {
        const skillPath = path === "SKILL.md" ? "" : path.slice(0, -"/SKILL.md".length);
        const fallback = skillPath.split("/").at(-1)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-+$/g, "") || "external-skill";
        const rawDescription = content.match(/^description:\s*(.*?)\s*$/m)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
        let skillId = fallback;
        let description = rawDescription;
        let incompatibility: string | undefined;
        try {
            const parsed = parseLocalSkillMarkdown(content);
            skillId = parsed.name;
            description = parsed.description;
        } catch (error) {
            if (error instanceof InvalidSkillFile) {
                incompatibility = this.formatFormatError(error);
                if (error.reason === "invalid_description") description = "Descrição acima do limite de 1 KB.";
            } else incompatibility = "SKILL.md não passou pela validação local do Helena.";
        }
        const candidate: GitHubSkillCandidate = {
            skillPath, skillId, description, revision: `sha256:${createHash("sha256").update(content).digest("hex")}`,
            compatible: !incompatibility, unsupportedFiles,
        };
        if (incompatibility) candidate.incompatibility = incompatibility;
        return candidate;
    }

    private incompatibleCandidate(path: string, reason: string): GitHubSkillCandidate {
        const skillPath = path === "SKILL.md" ? "" : path.slice(0, -"/SKILL.md".length);
        const fallback = skillPath.split("/").at(-1)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-+$/g, "") || "external-skill";
        return { skillPath, skillId: fallback, description: "", revision: `sha256:${"0".repeat(64)}`, compatible: false, incompatibility: reason, unsupportedFiles: [] };
    }

    private formatFormatError(error: InvalidSkillFile): string {
        if (error.reason.startsWith("unsupported_metadata:")) return `Metadado não suportado: ${error.reason.slice("unsupported_metadata:".length)}.`;
        if (error.reason.startsWith("duplicate_frontmatter_field:")) return `Metadado duplicado: ${error.reason.slice("duplicate_frontmatter_field:".length)}.`;
        const reasons: Record<string, string> = {
            frontmatter_missing: "SKILL.md sem frontmatter YAML delimitado por ---.",
            frontmatter_incomplete: "Frontmatter incompleto.",
            invalid_metadata: "O campo metadata aceita apenas valores escalares.",
            invalid_frontmatter_indentation: "A indentação do frontmatter não é compatível.",
            invalid_frontmatter_field: "Campo inválido no frontmatter.",
            unsupported_yaml_value: "O Client não aceita listas, estruturas ou tags YAML neste campo.",
            invalid_name: "O campo name precisa ser um identificador minúsculo com hífens (até 64 caracteres).",
            invalid_description: "O campo description é obrigatório e deve ter até 1 KB.",
            empty_body: "As instruções da skill estão vazias.",
            content_too_large: "As instruções excedem o limite de 32 KB.",
            frontmatter_too_large: "O frontmatter excede o limite permitido.",
        };
        return reasons[error.reason] ?? `SKILL.md incompatível com o Client (${error.reason}).`;
    }

    private async apiJson<T>(path: string): Promise<T> {
        let response: Response;
        try {
            response = await this.fetcher(`${API}${path}`, {
                headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Helena-Client" },
                redirect: "manual",
                signal: AbortSignal.timeout(15_000),
            });
        } catch {
            throw new GitHubSkillImportError("network", "Falha de rede ao consultar o GitHub. Tente novamente.");
        }
        if (response.status >= 300 && response.status < 400) throw new GitHubSkillImportError("network", "O GitHub respondeu com um redirecionamento não permitido.");
        if (response.status === 404 || response.status === 401 || response.status === 403) {
            throw new GitHubSkillImportError("not_found", "Repositório não encontrado ou privado/sem acesso público.");
        }
        if (!response.ok) throw new GitHubSkillImportError("network", "O GitHub está indisponível. Tente novamente.");
        const bytes = await readBounded(response, MAX_API_BODY_BYTES);
        try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T; }
        catch (error) {
            if (error instanceof GitHubSkillImportError) throw error;
            throw new GitHubSkillImportError("network", "Resposta inesperada do GitHub.");
        }
    }
}
