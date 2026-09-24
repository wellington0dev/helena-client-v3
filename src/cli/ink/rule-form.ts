import type { ContactRule, ContactRuleInput, DisclosurePreset, FileGrant, RuleScopeType } from "../api/contact-rules.ts";

/**
 * Conversão formulário ⇄ regra de atendimento — pura, testada em rule-form.test.ts. O formulário da CLI é só texto
 * (Form), então listas viram "separado por vírgula" e sim/não vira "s/n".
 */

export const PRESET_NAMES: Record<DisclosurePreset, string> = { cpf: "CPF", cnpj: "CNPJ", cartao: "cartão", email: "e-mail", telefone: "telefone", senha: "senha/token", pix: "chave PIX" };

export interface RuleScope {
    type: RuleScopeType;
    channel?: string;
    contactId?: string;
    groupId?: string;
    /** Texto pra mostrar ("Todos do WhatsApp", "Maria (WhatsApp)"). */
    label: string;
}

const list = (raw: string | undefined) => (raw ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const yes = (raw: string | undefined) => /^\s*s(im)?\s*$/i.test(raw ?? "");
const yn = (v: boolean | undefined) => (v ? "s" : "n");

/** Valores iniciais das 3 etapas — de uma regra existente ou vazios (nova). */
export function ruleToFormValues(rule?: ContactRule): Record<string, string> {
    const c = rule?.capabilities ?? {};
    const f = c.files?.[0];
    const m = c.mcp?.[0];
    const d = rule?.disclosure;
    return {
        name: rule?.name ?? "",
        task: rule?.taskDescription ?? "",
        condition: rule?.conditionText ?? "",
        forbidden: rule?.forbiddenText ?? "",
        notify: yn(rule?.notifyOwner ?? true),
        calCreate: yn(c.calendar?.create),
        calAvail: yn(c.calendar?.checkAvailability),
        calOnlyFree: yn(c.calendar?.onlyIfFree ?? true),
        calPerDay: String(c.calendar?.maxPerDay ?? 1),
        notes: yn(c.notes?.create),
        machine: f?.machine ?? "",
        readDirs: (f?.read?.dirs ?? []).join(", "),
        readExts: (f?.read?.extensions ?? []).join(", "),
        writeDirs: (f?.write?.dirs ?? []).join(", "),
        writeExts: (f?.write?.extensions ?? []).join(", "),
        deniedDirs: (f?.deniedDirs ?? []).join(", "),
        mcpConnection: m?.connectionId ?? "",
        mcpTools: (m?.tools ?? []).join(", "),
        presets: (d?.presets ?? []).join(", "),
        terms: (d?.terms ?? []).join(", "),
        templates: (d?.templates ?? []).join(", "),
    };
}

/**
 * Valores das 3 etapas → corpo da API. `mcpConnections` resolve o NOME digitado pro id. Erros em português; a
 * validação completa (pastas absolutas, posse, limites) é do backend — aqui só o que dá pra pegar antes.
 */
export function formValuesToRule(values: Record<string, string>, scope: RuleScope, mcpConnections: { id: string; name: string }[], enabled = true): { input?: ContactRuleInput; errors: string[] } {
    const errors: string[] = [];
    if (!values.name?.trim()) errors.push("Dê um nome à regra.");

    const perDay = Number(values.calPerDay || "1");
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > 20) errors.push("Compromissos por dia: de 1 a 20.");
    const calendar = yes(values.calCreate) || yes(values.calAvail) ? { create: yes(values.calCreate), checkAvailability: yes(values.calAvail), onlyIfFree: yes(values.calOnlyFree), maxPerDay: perDay } : undefined;

    const readDirs = list(values.readDirs);
    const writeDirs = list(values.writeDirs);
    const machine = values.machine?.trim();
    let files: FileGrant[] | undefined;
    if (readDirs.length || writeDirs.length) {
        if (!machine) errors.push("Arquivos: informe a máquina (o nome do dispositivo).");
        if (readDirs.length && list(values.readExts).length === 0) errors.push("Arquivos: informe os tipos de leitura (ex: pdf, xlsx).");
        if (writeDirs.length && list(values.writeExts).length === 0) errors.push("Arquivos: informe os tipos de escrita (ex: txt).");
        files = [
            {
                machine: machine ?? "",
                ...(readDirs.length && { read: { dirs: readDirs, extensions: list(values.readExts) } }),
                ...(writeDirs.length && { write: { dirs: writeDirs, extensions: list(values.writeExts) } }),
                deniedDirs: list(values.deniedDirs),
            },
        ];
    }

    const mcpName = values.mcpConnection?.trim();
    let mcp: { connectionId: string; tools: string[] }[] | undefined;
    if (mcpName) {
        const conn = mcpConnections.find((c) => c.id === mcpName || c.name.toLowerCase() === mcpName.toLowerCase());
        if (!conn) errors.push(`Integração "${mcpName}" não encontrada (veja os nomes em /integracoes).`);
        else if (list(values.mcpTools).length === 0) errors.push("Integração: informe as ferramentas liberadas.");
        else mcp = [{ connectionId: conn.id, tools: list(values.mcpTools) }];
    }

    const presetsRaw = list(values.presets).map((p) => p.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
    const presets: DisclosurePreset[] = [];
    for (const p of presetsRaw) {
        const hit = (Object.keys(PRESET_NAMES) as DisclosurePreset[]).find((k) => k === p || PRESET_NAMES[k].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === p);
        if (hit) presets.push(hit);
        else errors.push(`Tipo de dado "${p}" desconhecido (use: ${Object.values(PRESET_NAMES).join(", ")}).`);
    }
    const terms = list(values.terms);
    const templates = list(values.templates);

    if (errors.length) return { errors };
    return {
        errors,
        input: {
            name: values.name.trim(),
            enabled,
            scopeType: scope.type,
            scopeChannel: scope.channel ?? null,
            scopeContactId: scope.contactId ?? null,
            scopeGroupId: scope.groupId ?? null,
            taskDescription: values.task?.trim() || null,
            conditionText: values.condition?.trim() || null,
            forbiddenText: values.forbidden?.trim() || null,
            notifyOwner: yes(values.notify),
            capabilities: { ...(calendar && { calendar }), ...(yes(values.notes) && { notes: { create: true } }), ...(files && { files }), ...(mcp && { mcp }) },
            disclosure: presets.length || terms.length || templates.length ? { presets, terms, templates } : null,
        },
    };
}

/** Resumo de uma linha pra lista: o que a regra libera e o que protege. */
export function ruleSummary(rule: ContactRule): string {
    const c = rule.capabilities ?? {};
    const parts: string[] = [];
    if (c.calendar?.create) parts.push("marca agenda");
    if (c.calendar?.checkAvailability) parts.push("vê livre/ocupado");
    if (c.notes?.create) parts.push("deixa recado");
    for (const f of c.files ?? []) {
        if (f.read) parts.push(`lê ${f.read.extensions.join("/")}`);
        if (f.write) parts.push(`grava ${f.write.extensions.join("/")}`);
    }
    if (c.mcp?.length) parts.push(`integrações (${c.mcp.reduce((n, m) => n + m.tools.length, 0)})`);
    const d = rule.disclosure;
    const guards = (d?.presets.length ?? 0) + (d?.terms.length ?? 0) + (d?.templates.length ?? 0);
    if (guards) parts.push(`protege ${guards} dado(s)`);
    return parts.length ? parts.join(" · ") : "só orientação";
}
