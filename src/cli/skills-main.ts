import fs from "node:fs/promises";
import path from "node:path";
import { configDir } from "../local-api/paths.ts";
import { LocalSkillsManager } from "../local-skills-management.ts";

const [command, ...args] = process.argv.slice(2);
const manager = new LocalSkillsManager(path.join(configDir(), "skills"));

function usage(): never {
    throw new Error("Uso: helena skills list | inspect <id> | create <id> <descrição> <instruções> | install <URL-ou-arquivo> [diretório-da-skill] | edit <id> <descrição> <instruções> | enable <id> | disable <id> | remove <id> --yes");
}

async function currentRevision(id: string): Promise<string> {
    const item = (await manager.list()).find((skill) => skill.skillId === id);
    if (!item) throw new Error("Skill não encontrada.");
    return item.revision;
}

try {
    if (command === "list" && args.length === 0) {
        console.log(JSON.stringify(await manager.list(), null, 2));
    } else if (command === "inspect" && args[0]) {
        console.log(JSON.stringify(await manager.inspect(args[0], await currentRevision(args[0])), null, 2));
    } else if (command === "create" && args.length >= 3) {
        console.log(JSON.stringify(await manager.create({ skillId: args[0]!, description: args[1]!, instructions: args.slice(2).join(" ") }), null, 2));
    } else if (command === "install" && (args.length === 1 || args.length === 2)) {
        const source = args[0]!;
        if (/^https:\/\//i.test(source)) {
            const catalog = await manager.previewGit(source);
            const candidates = Array.isArray(catalog.skills) ? catalog.skills as Array<{ skillPath: string; skillId: string; compatible: boolean; incompatibility?: string }> : [];
            const selectedPath = args[1] ?? (candidates.length === 1 ? candidates[0]!.skillPath : undefined);
            if (selectedPath === undefined) {
                console.log(JSON.stringify(candidates.map(({ skillPath, skillId, compatible, incompatibility }) => ({ skillPath, skillId, compatible, incompatibility })), null, 2));
                throw new Error("Informe o diretório da skill desejada: helena skills install <URL> <diretório>");
            }
            const preview = await manager.previewGit(source, selectedPath);
            if (preview.kind !== "preview") throw new Error("Não foi possível gerar a prévia da skill selecionada.");
            console.log(`Prévia: ${String(preview.skillId)} — ${String(preview.description)}\nOrigem: ${String(preview.source)}\nRevisão: ${String(preview.sourceRevision)}`);
            if (Array.isArray(preview.unsupportedFiles) && preview.unsupportedFiles.length) {
                console.warn(`Aviso: somente SKILL.md será instalada; arquivos auxiliares não suportados: ${(preview.unsupportedFiles as string[]).join(", ")}`);
            }
            console.log(preview.instructions);
            if (process.env.HELENA_CONFIRM_INSTALL !== "1") throw new Error("Revise a prévia acima e repita com HELENA_CONFIRM_INSTALL=1 para instalar.");
            const hasUnsupportedFiles = Array.isArray(preview.unsupportedFiles) && preview.unsupportedFiles.length > 0;
            if (hasUnsupportedFiles && process.env.HELENA_ALLOW_UNSUPPORTED_SKILL_FILES !== "1") throw new Error("Confirme que deseja instalar somente SKILL.md definindo HELENA_ALLOW_UNSUPPORTED_SKILL_FILES=1.");
            console.log(JSON.stringify(await manager.installGit(String(preview.source), String(preview.skillPath), String(preview.sourceRevision), hasUnsupportedFiles), null, 2));
        } else {
            const selected = path.resolve(source);
            const stat = await fs.stat(selected);
            const skillFile = stat.isDirectory() ? path.join(selected, "SKILL.md") : selected;
            const content = await fs.readFile(skillFile, "utf8");
            const preview = manager.previewMarkdown(content);
            console.log(`Prévia: ${preview.skillId} — ${preview.description}\nOrigem: ${skillFile}`);
            console.log(preview.instructions);
            if (process.env.HELENA_CONFIRM_INSTALL !== "1") throw new Error("Revise a prévia acima e repita com HELENA_CONFIRM_INSTALL=1 para instalar.");
            console.log(JSON.stringify(await manager.installMarkdown(content, "local-file"), null, 2));
        }
    } else if (command === "edit" && args.length >= 3) {
        const skillId = args[0]!;
        console.log(JSON.stringify(await manager.edit({
            skillId, revision: await currentRevision(skillId), description: args[1]!, instructions: args.slice(2).join(" "),
        }), null, 2));
    } else if ((command === "enable" || command === "disable") && args.length === 1) {
        console.log(JSON.stringify(await manager.setEnabled(args[0]!, await currentRevision(args[0]!), command === "enable"), null, 2));
    } else if (command === "remove" && args.length === 2 && args[1] === "--yes") {
        console.log(JSON.stringify(await manager.remove(args[0]!, await currentRevision(args[0]!), true), null, 2));
    } else {
        usage();
    }
} catch (error) {
    console.error(`[helena skills] ${error instanceof Error ? error.message : "Falha inesperada."}`);
    process.exitCode = 1;
}
