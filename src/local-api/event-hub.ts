/**
 * Event Hub — evolução do `status-bus.ts` (que agora mora ao lado): pub/sub em memória com (a) ESTADO por tópico, mandado inteiro
 * a quem conecta, e (b) um buffer curto de eventos importantes, pra quem abre a TUI depois ver "o que
 * aconteceu enquanto você estava fora". Uma única fonte pra TUI, canais e machine-agent.
 */
export interface HubEvent {
    id: number;
    ts: number;
    type: string;
    data: unknown;
}

type Listener = (event: HubEvent) => void;

export interface EventHub {
    /** Estado atual por tópico (ex.: "channels", "session", "backend"). */
    snapshot(): Record<string, unknown>;
    setState(topic: string, value: unknown): void;
    /** Evento pontual (ex.: "chat.progress", "session.expired"). */
    publish(type: string, data: unknown): void;
    subscribe(listener: Listener): () => void;
    /** Últimos eventos marcados como "importantes" (ver `keepTypes`). */
    missed(sinceId?: number): HubEvent[];
}

export function createEventHub(options: { bufferSize?: number; keepTypes?: string[] } = {}): EventHub {
    const bufferSize = options.bufferSize ?? 100;
    const keepTypes = new Set(options.keepTypes ?? ["job_done", "project_event", "session.expired"]);
    const states: Record<string, unknown> = {};
    const listeners = new Set<Listener>();
    const buffer: HubEvent[] = [];
    let seq = 0;

    function emit(type: string, data: unknown): void {
        const event: HubEvent = { id: ++seq, ts: Date.now(), type, data };
        if (keepTypes.has(type) || (type === "chat.progress" && keepTypes.has(String((data as { type?: string } | undefined)?.type)))) {
            buffer.push(event);
            if (buffer.length > bufferSize) buffer.shift();
        }
        for (const listener of listeners) {
            try {
                listener(event);
            } catch {
                // um assinante quebrado nunca derruba os outros nem o publicador.
            }
        }
    }

    return {
        snapshot: () => ({ ...states }),
        setState(topic, value) {
            states[topic] = value;
            emit(`state.${topic}`, value);
        },
        publish: emit,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        missed: (sinceId = 0) => buffer.filter((e) => e.id > sinceId),
    };
}
