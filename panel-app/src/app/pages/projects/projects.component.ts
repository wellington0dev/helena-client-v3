import { HttpErrorResponse } from "@angular/common/http";
import { Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import type { AgentRole } from "../../core/agent-personas.service";
import { AgentPersonasService, DEFAULT_AGENT_NAMES } from "../../core/agent-personas.service";
import type { AutonomyDecision, AutonomyMode, ProjectDetail, ProjectStepRole, ProjectSummary } from "../../core/projects.service";
import { ProjectsService } from "../../core/projects.service";
import { IconComponent } from "../../shared/icon.component";

const STATUS_LABEL: Record<ProjectSummary["status"], string> = {
    draft: "Rascunho",
    planning: "Planejando",
    active: "Em andamento",
    paused: "Pausado",
    needs_revision: "Em revisão",
    completed: "Concluído",
    cancelled: "Cancelado",
};

const TERMINAL_STATUSES = new Set<ProjectSummary["status"]>(["completed", "cancelled"]);

const ROLE_TITLE: Record<ProjectStepRole, string> = {
    architect: "Arquiteta",
    designer: "Designer",
    frontend: "Frontend",
    backend: "Backend",
    dba: "DBA",
    security: "Segurança",
    qa: "QA",
};

const PERSONA_ROLE_ORDER: AgentRole[] = ["architect", "designer", "frontend", "backend", "dba", "security", "qa"];

const STEP_STATUS_LABEL: Record<string, string> = {
    ready: "Na fila",
    running: "Rodando",
    done: "Concluído",
    failed: "Falhou",
};

const EVENT_KIND_LABEL: Record<string, string> = {
    created: "Criado",
    plan_approved: "Plano aprovado",
    paused_cost_cap: "Pausado — custo estourou",
    paused_qa_failure: "Pausado — QA reprovou",
    paused_awaiting_decision: "Pausado — aguardando decisão",
    revision_requested: "Revisão pedida",
    resumed: "Retomado",
    completed: "Concluído",
    cancelled: "Cancelado",
};

const AUTONOMY_LABEL: Record<AutonomyDecision, { title: string; hint: string }> = {
    qa_failure: {
        title: "QA reprova um Project",
        hint: 'Desligado (padrão): pausa e avisa você. Ligado: a Helena decide sozinha se reabre algum papel pra corrigir, sem pausar — reabre TODOS os papéis de implementação com o relatório da QA como contexto.',
    },
    revision_scope_change: {
        title: "Pedido de revisão parece mudar o escopo",
        hint: "Desligado (padrão): pausa e pergunta se quer que a Arquiteta replaneje. Ligado: a Helena decide sozinha.",
    },
};

interface RevisionForm {
    projectId: string;
    roles: Record<ProjectStepRole, boolean>;
    note: string;
}

const REVISION_ROLES: ProjectStepRole[] = ["designer", "frontend", "backend", "dba", "security"];
const AUTONOMY_DECISIONS: AutonomyDecision[] = ["qa_failure", "revision_scope_change"];

function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
        const message = err.error?.message;
        // ValidationPipe (class-validator) devolve um ARRAY de mensagens, não uma string — achado real ao validar costCapValue: sem isto, qualquer rejeição de validação mostrava só o fallback genérico.
        if (typeof message === "string") return message;
        if (Array.isArray(message) && message.every((m) => typeof m === "string")) return message.join(" — ");
    }
    return err instanceof Error ? err.message : fallback;
}

/**
 * Página "Projects" — a equipe de agentes de desenvolvimento (Arquiteta,
 * Designer, Frontend, Backend, DBA, QA). Ver
 * docs/agent-team-architecture.md §4/§8. Lista + detalhe expansível (mesmo
 * padrão de pages/contacts), criação via formulário (dispara o Arquiteto
 * de verdade — pode demorar alguns segundos, é uma chamada real de IA),
 * pedir revisão (só em Project concluído), retomar (só em Project
 * pausado), e a política de autonomia (o que a Helena decide sozinha vs.
 * o que pausa esperando você).
 */
@Component({
    selector: "app-projects",
    imports: [FormsModule, IconComponent, RouterLink],
    templateUrl: "./projects.component.html",
    styleUrl: "./projects.component.css",
})
export class ProjectsComponent {
    private readonly projects = inject(ProjectsService);
    private readonly agentPersonasApi = inject(AgentPersonasService);

    protected readonly statusLabel = STATUS_LABEL;
    protected readonly stepStatusLabel = STEP_STATUS_LABEL;
    protected readonly eventKindLabel = EVENT_KIND_LABEL;
    protected readonly autonomyLabel = AUTONOMY_LABEL;
    protected readonly revisionRoleOptions = REVISION_ROLES;
    protected readonly autonomyDecisions = AUTONOMY_DECISIONS;
    protected readonly personaRoleOptions = PERSONA_ROLE_ORDER;

    protected readonly agentPersonas = signal<Record<AgentRole, string>>(DEFAULT_AGENT_NAMES);
    protected readonly showPersonasPanel = signal(false);
    protected readonly editingPersonaRole = signal<AgentRole | null>(null);
    protected personaDraft = "";
    protected readonly personaSaving = signal<AgentRole | null>(null);
    protected readonly personaError = signal("");

    /** "Arquiteta (Ada)" etc. — reflete o nome customizado assim que carrega. */
    protected readonly roleLabel = computed<Record<ProjectStepRole, string>>(() => {
        const names = this.agentPersonas();
        return Object.fromEntries(PERSONA_ROLE_ORDER.map((role) => [role, `${ROLE_TITLE[role]} (${names[role]})`])) as Record<ProjectStepRole, string>;
    });

    protected readonly list = signal<ProjectSummary[]>([]);
    protected readonly loaded = signal(false);
    protected readonly error = signal("");

    protected readonly expandedId = signal<string | null>(null);
    protected readonly detail = signal<ProjectDetail | null>(null);
    protected readonly detailLoading = signal(false);

    protected readonly creating = signal(false);
    protected createSpec = "";
    protected createMachine = "";
    // `type="number"` no template — NumberValueAccessor do Angular liga isto como number|null, nunca string (bug real ao vivo: chamar .trim() aqui quebrava com "this.createCostCapValue.trim is not a function").
    protected createCostCapValue: number | null = null;
    protected createGitPushAllowed = false;
    protected readonly createSaving = signal(false);
    protected readonly createError = signal("");

    protected readonly revisionForm = signal<RevisionForm | null>(null);
    protected readonly revisionSaving = signal(false);
    protected readonly revisionError = signal("");

    protected readonly resumingId = signal<string | null>(null);

    protected readonly cancelForm = signal<{ projectId: string; reason: string } | null>(null);
    protected readonly cancelSaving = signal(false);
    protected readonly cancelError = signal("");

    protected readonly deleteForm = signal<{ projectId: string } | null>(null);
    protected readonly deleteSaving = signal(false);
    protected readonly deleteError = signal("");

    protected readonly autonomyPolicies = signal<Record<AutonomyDecision, AutonomyMode> | null>(null);
    protected readonly autonomySaving = signal<AutonomyDecision | null>(null);
    protected readonly showAutonomyPanel = signal(false);

    protected readonly lastEventNote = computed(() => {
        const events = this.detail()?.events ?? [];
        return events.at(-1)?.note ?? "";
    });

    constructor() {
        void this.reload();
        void this.loadAutonomyPolicies();
        void this.loadAgentPersonas();
    }

    private async reload(): Promise<void> {
        try {
            this.list.set(await this.projects.list());
            this.loaded.set(true);
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Não consegui carregar os Projects."));
        }
    }

    private async loadAutonomyPolicies(): Promise<void> {
        try {
            this.autonomyPolicies.set(await this.projects.listAutonomyPolicies());
        } catch {
            // Painel de preferências some silenciosamente se falhar — não é crítico pra ver a lista de Projects.
        }
    }

    private async loadAgentPersonas(): Promise<void> {
        try {
            this.agentPersonas.set(await this.agentPersonasApi.listAll());
        } catch {
            // Nomes customizados somem silenciosamente se falhar — os defaults (Ada, Vera...) já cobrem a UI.
        }
    }

    protected async toggleExpand(project: ProjectSummary): Promise<void> {
        if (this.expandedId() === project.id) {
            this.expandedId.set(null);
            this.detail.set(null);
            this.revisionForm.set(null);
            this.cancelForm.set(null);
            this.deleteForm.set(null);
            return;
        }

        this.expandedId.set(project.id);
        this.revisionForm.set(null);
        this.cancelForm.set(null);
        this.deleteForm.set(null);
        this.detail.set(null);
        this.detailLoading.set(true);
        try {
            this.detail.set(await this.projects.get(project.id));
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Não consegui carregar os detalhes deste Project."));
        } finally {
            this.detailLoading.set(false);
        }
    }

    protected openCreateForm(): void {
        this.creating.set(true);
        this.createSpec = "";
        this.createMachine = "";
        this.createCostCapValue = null;
        this.createGitPushAllowed = false;
        this.createError.set("");
    }

    protected closeCreateForm(): void {
        this.creating.set(false);
        this.createError.set("");
    }

    protected async submitCreate(): Promise<void> {
        const spec = this.createSpec.trim();
        if (!spec) return;

        this.createSaving.set(true);
        this.createError.set("");
        try {
            const costCapValue = this.createCostCapValue ?? undefined;
            const outcome = await this.projects.create({
                spec,
                machine: this.createMachine.trim() || undefined,
                costCapValue,
                gitPushAllowed: this.createGitPushAllowed || undefined,
            });

            if (outcome.error) {
                this.createError.set(outcome.error);
                return;
            }

            this.creating.set(false);
            await this.reload();
            if (outcome.projectId) {
                const created = this.list().find((p) => p.id === outcome.projectId);
                if (created) await this.toggleExpand(created);
            }
        } catch (err) {
            this.createError.set(extractErrorMessage(err, "Não consegui criar o Project."));
        } finally {
            this.createSaving.set(false);
        }
    }

    protected openRevisionForm(projectId: string): void {
        this.revisionForm.set({
            projectId,
            roles: { architect: false, designer: false, frontend: false, backend: false, dba: false, security: false, qa: false },
            note: "",
        });
        this.revisionError.set("");
    }

    protected closeRevisionForm(): void {
        this.revisionForm.set(null);
        this.revisionError.set("");
    }

    protected toggleRevisionRole(role: ProjectStepRole, checked: boolean): void {
        const form = this.revisionForm();
        if (!form) return;
        this.revisionForm.set({ ...form, roles: { ...form.roles, [role]: checked } });
    }

    protected updateRevisionNote(note: string): void {
        const form = this.revisionForm();
        if (!form) return;
        this.revisionForm.set({ ...form, note });
    }

    protected readonly canSubmitRevision = computed(() => {
        const form = this.revisionForm();
        if (!form) return false;
        return form.note.trim().length > 0 && Object.values(form.roles).some(Boolean);
    });

    protected async submitRevision(): Promise<void> {
        const form = this.revisionForm();
        if (!form) return;
        const roles = REVISION_ROLES.filter((role) => form.roles[role]);
        if (roles.length === 0 || !form.note.trim()) return;

        this.revisionSaving.set(true);
        this.revisionError.set("");
        try {
            const outcome = await this.projects.requestRevision(form.projectId, roles, form.note.trim());
            if (!outcome.ok) {
                this.revisionError.set(outcome.error ?? "Não consegui pedir a revisão.");
                return;
            }
            this.revisionForm.set(null);
            await this.reload();
            const project = this.list().find((p) => p.id === form.projectId);
            if (project) await this.toggleExpand(project);
        } catch (err) {
            this.revisionError.set(extractErrorMessage(err, "Não consegui pedir a revisão."));
        } finally {
            this.revisionSaving.set(false);
        }
    }

    protected async resume(projectId: string): Promise<void> {
        this.resumingId.set(projectId);
        try {
            const outcome = await this.projects.resume(projectId);
            if (!outcome.ok) {
                this.error.set(outcome.error ?? "Não consegui retomar este Project.");
                return;
            }
            await this.reload();
            const project = this.list().find((p) => p.id === projectId);
            if (project) await this.toggleExpand(project);
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Não consegui retomar este Project."));
        } finally {
            this.resumingId.set(null);
        }
    }

    protected canCancel(status: ProjectSummary["status"]): boolean {
        return !TERMINAL_STATUSES.has(status);
    }

    protected openCancelForm(projectId: string): void {
        this.cancelForm.set({ projectId, reason: "" });
        this.cancelError.set("");
    }

    protected closeCancelForm(): void {
        this.cancelForm.set(null);
        this.cancelError.set("");
    }

    protected updateCancelReason(reason: string): void {
        const form = this.cancelForm();
        if (!form) return;
        this.cancelForm.set({ ...form, reason });
    }

    protected async submitCancel(): Promise<void> {
        const form = this.cancelForm();
        if (!form) return;

        this.cancelSaving.set(true);
        this.cancelError.set("");
        try {
            const outcome = await this.projects.cancel(form.projectId, form.reason.trim() || undefined);
            if (!outcome.ok) {
                this.cancelError.set(outcome.error ?? "Não consegui cancelar este Project.");
                return;
            }
            this.cancelForm.set(null);
            await this.reload();
            const project = this.list().find((p) => p.id === form.projectId);
            if (project) await this.toggleExpand(project);
        } catch (err) {
            this.cancelError.set(extractErrorMessage(err, "Não consegui cancelar este Project."));
        } finally {
            this.cancelSaving.set(false);
        }
    }

    /** Só Project terminal (completed/cancelled) — o oposto de canCancel. Apagar um Project ainda em andamento derrubaria o chão de um agente em pleno turno. */
    protected canDelete(status: ProjectSummary["status"]): boolean {
        return TERMINAL_STATUSES.has(status);
    }

    protected openDeleteForm(projectId: string): void {
        this.deleteForm.set({ projectId });
        this.deleteError.set("");
    }

    protected closeDeleteForm(): void {
        this.deleteForm.set(null);
        this.deleteError.set("");
    }

    protected async submitDelete(): Promise<void> {
        const form = this.deleteForm();
        if (!form) return;

        this.deleteSaving.set(true);
        this.deleteError.set("");
        try {
            const outcome = await this.projects.remove(form.projectId);
            if (!outcome.ok) {
                this.deleteError.set(outcome.error ?? "Não consegui apagar este Project.");
                return;
            }
            this.deleteForm.set(null);
            this.expandedId.set(null);
            this.detail.set(null);
            await this.reload();
        } catch (err) {
            this.deleteError.set(extractErrorMessage(err, "Não consegui apagar este Project."));
        } finally {
            this.deleteSaving.set(false);
        }
    }

    protected async toggleAutonomy(decision: AutonomyDecision): Promise<void> {
        const current = this.autonomyPolicies();
        if (!current) return;

        const nextMode: AutonomyMode = current[decision] === "auto" ? "ask" : "auto";
        this.autonomySaving.set(decision);
        try {
            this.autonomyPolicies.set(await this.projects.setAutonomyPolicy(decision, nextMode));
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Não consegui salvar essa preferência."));
        } finally {
            this.autonomySaving.set(null);
        }
    }

    protected isPersonaCustomized(role: AgentRole): boolean {
        return this.agentPersonas()[role] !== DEFAULT_AGENT_NAMES[role];
    }

    protected startEditingPersona(role: AgentRole): void {
        this.editingPersonaRole.set(role);
        this.personaDraft = this.agentPersonas()[role];
        this.personaError.set("");
    }

    protected cancelEditingPersona(): void {
        this.editingPersonaRole.set(null);
        this.personaError.set("");
    }

    protected async savePersona(role: AgentRole): Promise<void> {
        const name = this.personaDraft.trim();
        if (!name) return;

        this.personaSaving.set(role);
        this.personaError.set("");
        try {
            this.agentPersonas.set(await this.agentPersonasApi.setName(role, name));
            this.editingPersonaRole.set(null);
        } catch (err) {
            this.personaError.set(extractErrorMessage(err, "Não consegui salvar esse nome."));
        } finally {
            this.personaSaving.set(null);
        }
    }

    protected async resetPersona(role: AgentRole): Promise<void> {
        this.personaSaving.set(role);
        this.personaError.set("");
        try {
            this.agentPersonas.set(await this.agentPersonasApi.reset(role));
            this.editingPersonaRole.set(null);
        } catch (err) {
            this.personaError.set(extractErrorMessage(err, "Não consegui restaurar o nome padrão."));
        } finally {
            this.personaSaving.set(null);
        }
    }
}
