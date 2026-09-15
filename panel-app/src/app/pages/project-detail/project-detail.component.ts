import { JsonPipe } from "@angular/common";
import { HttpErrorResponse } from "@angular/common/http";
import { Component, OnDestroy, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, RouterLink } from "@angular/router";
import type { AgentRole } from "../../core/agent-personas.service";
import { AgentPersonasService, DEFAULT_AGENT_NAMES } from "../../core/agent-personas.service";
import type { ProjectDetail, ProjectStepRole, ProjectStepSummary, StepTranscript } from "../../core/projects.service";
import { ProjectsService } from "../../core/projects.service";

const STATUS_LABEL: Record<ProjectDetail["project"]["status"], string> = {
    draft: "Rascunho",
    planning: "Planejando",
    active: "Em andamento",
    paused: "Pausado",
    needs_revision: "Em revisão",
    completed: "Concluído",
    cancelled: "Cancelado",
};

/** Só os papéis "clássicos" têm rótulo pré-definido — um papel inventado na hora (ver §14 do doc de arquitetura do backend-v2) cai no fallback capitalizado (ver `roleLabel`). */
const ROLE_TITLE: Partial<Record<ProjectStepRole, string>> = {
    architect: "Arquiteta",
    designer: "Designer",
    frontend: "Frontend",
    backend: "Backend",
    dba: "DBA",
    security: "Segurança",
    qa: "QA",
};

/** Ordem fixa dos papéis clássicos — qualquer papel dinâmico (fora desta lista) aparece DEPOIS, na ordem em que os steps foram criados (ver `visibleSteps`). */
const ROLE_ORDER: ProjectStepRole[] = ["architect", "designer", "frontend", "backend", "dba", "security", "qa"];

function capitalize(role: string): string {
    return role.length > 0 ? role[0]!.toUpperCase() + role.slice(1) : role;
}

const STEP_STATUS_LABEL: Record<string, string> = { ready: "Na fila", running: "Rodando", done: "Concluído", failed: "Falhou" };

/** Não dá pra mandar mensagem enquanto o próprio agente está rodando — dois chat.send() concorrentes na mesma sessão não é seguro (ver AgentConversationService no backend). */
const IDLE_STATUSES = new Set<ProjectStepSummary["status"]>(["done", "failed"]);

function extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
        const message = err.error?.message;
        if (typeof message === "string") return message;
        if (Array.isArray(message) && message.every((m) => typeof m === "string")) return message.join(" — ");
    }
    return err instanceof Error ? err.message : fallback;
}

/**
 * Página individual de um Project (id pela URL) — pedido explícito do
 * dono, 2026-09-09: um painel por agente mostrando ações/raciocínio/
 * progresso (transcrição real da sessão genkit, ver
 * ProjectStepMessagesService no backend) e um campo pra conversar direto
 * com aquele agente (AgentConversationService).
 */
@Component({
    selector: "app-project-detail",
    imports: [FormsModule, RouterLink, JsonPipe],
    templateUrl: "./project-detail.component.html",
    styleUrl: "./project-detail.component.css",
})
export class ProjectDetailComponent implements OnDestroy {
    private readonly route = inject(ActivatedRoute);
    private readonly projects = inject(ProjectsService);
    private readonly agentPersonasApi = inject(AgentPersonasService);

    protected readonly projectId = this.route.snapshot.paramMap.get("id")!;
    protected readonly statusLabel = STATUS_LABEL;
    protected readonly stepStatusLabel = STEP_STATUS_LABEL;

    protected readonly detail = signal<ProjectDetail | null>(null);
    protected readonly loaded = signal(false);
    protected readonly error = signal("");

    protected readonly agentPersonas = signal<Record<AgentRole, string>>(DEFAULT_AGENT_NAMES);
    protected readonly transcripts = signal<Partial<Record<ProjectStepRole, StepTranscript>>>({});
    protected readonly drafts = signal<Partial<Record<ProjectStepRole, string>>>({});
    protected readonly sending = signal<Partial<Record<ProjectStepRole, boolean>>>({});
    protected readonly sendErrors = signal<Partial<Record<ProjectStepRole, string>>>({});

    private pollHandle?: ReturnType<typeof setInterval>;

    /** Papéis clássicos na ordem fixa de exibição, seguidos de qualquer papel DINÂMICO (inventado na hora — ver §14) na ordem em que os steps foram criados — nunca escondido só por não estar no catálogo fixo. */
    protected readonly visibleSteps = computed<ProjectStepSummary[]>(() => {
        const steps = this.detail()?.steps ?? [];
        const byRole = new Map(steps.map((s) => [s.role, s]));
        const classic = ROLE_ORDER.map((role) => byRole.get(role)).filter((s): s is ProjectStepSummary => !!s);
        const dynamic = steps.filter((s) => !ROLE_ORDER.includes(s.role));
        return [...classic, ...dynamic];
    });

    constructor() {
        void this.load();
        void this.loadPersonas();
        this.pollHandle = setInterval(() => void this.refresh(), 4000);
    }

    ngOnDestroy(): void {
        if (this.pollHandle) clearInterval(this.pollHandle);
    }

    private async loadPersonas(): Promise<void> {
        try {
            this.agentPersonas.set(await this.agentPersonasApi.listAll());
        } catch {
            // Nomes customizados somem silenciosamente se falhar — os defaults já cobrem a UI.
        }
    }

    protected roleLabel(role: ProjectStepRole): string {
        const title = ROLE_TITLE[role] ?? capitalize(role);
        const customName = this.agentPersonas()[role];
        return customName ? `${title} (${customName})` : title;
    }

    protected canMessage(role: ProjectStepRole): boolean {
        const step = this.visibleSteps().find((s) => s.role === role);
        return !!step?.status && IDLE_STATUSES.has(step.status);
    }

    private async load(): Promise<void> {
        try {
            this.detail.set(await this.projects.get(this.projectId));
            this.loaded.set(true);
            await this.loadTranscripts();
        } catch (err) {
            this.error.set(extractErrorMessage(err, "Não consegui carregar este Project."));
        }
    }

    /** Chamado pelo poller — recarrega tudo de novo enquanto o Project não estiver num status terminal, pra refletir progresso ao vivo sem precisar de WebSocket dedicado. */
    private async refresh(): Promise<void> {
        const current = this.detail();
        if (!current) return;
        if (current.project.status === "completed" || current.project.status === "cancelled") return;

        try {
            this.detail.set(await this.projects.get(this.projectId));
            await this.loadTranscripts();
        } catch {
            // Falha de poll silenciosa — a carga inicial já mostrou erro se fosse o caso; não interrompe a tela por uma falha passageira.
        }
    }

    private async loadTranscripts(): Promise<void> {
        const steps = this.visibleSteps();
        const entries = await Promise.all(
            steps.map(async (step) => {
                try {
                    return [step.role, await this.projects.getStepMessages(this.projectId, step.role)] as const;
                } catch {
                    return [step.role, { messages: [] }] as const;
                }
            }),
        );
        this.transcripts.set(Object.fromEntries(entries));
    }

    protected updateDraft(role: ProjectStepRole, value: string): void {
        this.drafts.update((d) => ({ ...d, [role]: value }));
    }

    protected async sendMessage(role: ProjectStepRole): Promise<void> {
        const message = (this.drafts()[role] ?? "").trim();
        if (!message) return;

        this.sending.update((s) => ({ ...s, [role]: true }));
        this.sendErrors.update((s) => ({ ...s, [role]: "" }));
        try {
            const outcome = await this.projects.sendStepMessage(this.projectId, role, message);
            if (outcome.error) {
                this.sendErrors.update((s) => ({ ...s, [role]: outcome.error! }));
                return;
            }
            this.drafts.update((d) => ({ ...d, [role]: "" }));
            const transcript = await this.projects.getStepMessages(this.projectId, role);
            this.transcripts.update((t) => ({ ...t, [role]: transcript }));
        } catch (err) {
            this.sendErrors.update((s) => ({ ...s, [role]: extractErrorMessage(err, "Não consegui mandar a mensagem.") }));
        } finally {
            this.sending.update((s) => ({ ...s, [role]: false }));
        }
    }
}
