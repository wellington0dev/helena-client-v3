import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formValuesToRule, ruleToFormValues, type RuleScope } from "../../src/cli/ink/rule-form.ts";

type Screen =
  | "home"
  | "chat"
  | "channels"
  | "contacts"
  | "rules"
  | "integrations"
  | "credits"
  | "usage"
  | "settings";
type SessionRow = { id: string; preview?: string; updatedAt?: string };
type MessageRow = { role: string; text: string; createdAt?: string };
type PendingConfirmation = { tool: string; ref?: string; input: unknown };

const navigation: { id: Screen; label: string; icon: string; group: string }[] =
  [
    { id: "home", label: "Painel", icon: "⌂", group: "Operação" },
    { id: "chat", label: "Conversas", icon: "◌", group: "Operação" },
    { id: "contacts", label: "Contatos", icon: "♧", group: "Operação" },
    {
      id: "rules",
      label: "Regras de atendimento",
      icon: "◇",
      group: "Operação",
    },
    { id: "channels", label: "Canais", icon: "↔", group: "Sistema" },
    { id: "integrations", label: "Integrações", icon: "⌘", group: "Sistema" },
    { id: "credits", label: "Créditos e limites", icon: "◈", group: "Gestão" },
    { id: "usage", label: "Uso", icon: "▥", group: "Gestão" },
    { id: "settings", label: "Configurações", icon: "⚙", group: "Gestão" },
  ];

async function request<T = any>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  if (!window.helena) throw new Error("Abra a Helena pelo aplicativo desktop.");
  const result = await window.helena.request(path, options);
  if (!result.ok)
    throw new Error(
      result.data?.message || `Falha ao carregar (${result.status}).`,
    );
  return result.data as T;
}

const backend = <T,>(
  path: string,
  options?: { method?: string; body?: unknown },
) => request<T>(`/v1/backend${path}`, options);

export function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [loggedIn, setLoggedIn] = useState(false);
  const [starting, setStarting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [machineName, setMachineName] = useState("");
  const [password, setPassword] = useState("");
  const [registerMode, setRegisterMode] = useState(false);
  const [payload, setPayload] = useState<any>(null);
  const [channelState, setChannelState] = useState<any>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [chatProgress, setChatProgress] = useState("");
  const [pending, setPending] = useState<PendingConfirmation[]>([]);
  const [telegramToken, setTelegramToken] = useState("");
  const loadSequence = useRef(0);

  const current = useMemo(
    () => navigation.find((item) => item.id === screen)!,
    [screen],
  );

  useEffect(() => {
    document.documentElement.dataset.screen = screen;
  }, [screen]);

  const navigateTo = useCallback((target: Screen) => {
    // Invalidate in-flight work synchronously on click, before the new
    // screen's effect starts its own request.
    loadSequence.current += 1;
    setError("");
    setScreen(target);
  }, []);

  useEffect(() => {
    request<{ loggedIn: boolean }>("/v1/session/status")
      .then(async (result) => {
        setLoggedIn(result.loggedIn);
        if (result.loggedIn) {
          try { const user = await backend<any>("/auth/me"); setEmail(user.email ?? ""); }
          catch { /* a tela principal exibirá o erro caso a conta não responda */ }
        }
      })
      .catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Backend local indisponível.",
        ),
      )
      .finally(() => setStarting(false));
  }, []);

  useEffect(() => {
    if (!loggedIn || !window.helena) return;
    return window.helena.onEvent((raw: any) => {
      if (raw?.type === "state" && raw.data?.channels) setChannelState(raw.data.channels);
      if (raw?.type === "state.channels") setChannelState(raw.data);
      if (raw?.type === "chat.progress") {
        const event = raw.data ?? {};
        setChatProgress(
          event.text ||
            event.status ||
            event.toolName ||
            "Helena está trabalhando…",
        );
      }
      if ((raw?.type === "state.session" && raw.data?.loggedIn === false) || raw?.type === "session.expired") {
        setLoggedIn(false);
        setError("Sua sessão expirou. Entre novamente para continuar.");
      }
    });
  }, [loggedIn]);

  const loadScreen = useCallback(async () => {
    if (!loggedIn) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      let result: unknown;
      if (screen === "home") {
        const [doctor, channels, machine, config] = await Promise.all([
          request("/v1/doctor"),
          request("/v1/channels"),
          request("/v1/machine"),
          request("/v1/config"),
        ]);
        setMachineName((machine as any)?.name ?? "");
        result = { doctor, channels, machine, config };
      } else if (screen === "chat") {
        const [rawList, machine] = await Promise.all([
          backend<SessionRow[]>("/chat/sessions/summaries?limit=30"),
          request<any>("/v1/machine"),
        ]);
        if (sequence !== loadSequence.current) return;
        const list = Array.isArray(rawList) ? rawList : [];
        setMachineName(machine?.name ?? "");
        setSessions(list);
        const selected =
          sessionId === "__new__" ? "" : sessionId || list[0]?.id || "";
        if (sessionId !== "__new__") setSessionId(selected);
        if (selected) {
          const history = await backend<{ entries: MessageRow[] }>(
            `/chat/sessions/${encodeURIComponent(selected)}/history?limit=60`,
          );
          if (sequence !== loadSequence.current) return;
          setMessages(Array.isArray(history.entries) ? history.entries : []);
        } else setMessages([]);
      } else if (screen === "channels") result = await request("/v1/channels");
      else if (screen === "contacts") {
        const contacts = await backend("/contacts");
        result = Array.isArray(contacts) ? contacts : [];
      }
      else if (screen === "rules") {
        const [rules, contacts, integrations] = await Promise.all([backend("/contact-rules"), backend("/contacts"), backend("/mcp-connections")]);
        result = {
          rules: Array.isArray(rules) ? rules : [],
          contacts: Array.isArray(contacts) ? contacts : [],
          integrations: Array.isArray(integrations) ? integrations : [],
        };
      }
      else if (screen === "integrations")
      {
        const integrations = await backend("/mcp-connections");
        result = Array.isArray(integrations) ? integrations : [];
      }
      else if (screen === "credits") {
        const [balance, limits, rate, coupons] = await Promise.all([
          backend("/billing/balance"),
          backend("/billing/limits"),
          backend("/billing/rate"),
          backend("/coupons/pending"),
        ]);
        result = { balance, limits, rate, coupons };
      } else if (screen === "usage")
        result = await Promise.all([
          backend("/dashboard/usage"),
          backend("/dashboard/usage/messages?limit=30"),
        ]);
      else if (screen === "settings") {
        const [sessions, config, user] = await Promise.all([backend("/auth/sessions"), request("/v1/config"), backend<any>("/auth/me")]);
        result = { sessions: Array.isArray(sessions) ? sessions : [], config, user };
        if (user?.email) setEmail(user.email);
      }
      if (sequence !== loadSequence.current) return;
      if (screen === "home") setChannelState((current: any) => current ?? (result as any)?.channels ?? null);
      if (screen === "channels") setChannelState(result);
      if (result !== undefined) setPayload(result);
    } catch (cause) {
      if (sequence !== loadSequence.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar esta tela.",
      );
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [loggedIn, screen, sessionId]);

  useEffect(() => {
    void loadScreen();
  }, [loadScreen]);

  async function authenticate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await request(`/v1/session/${registerMode ? "register" : "login"}`, {
        method: "POST",
        body: { email, password },
      });
      setLoggedIn(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível entrar.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    setChatProgress("");
    setMessages((rows) => [...rows, { role: "user", text }]);
    setSending(true);
    try {
      const result = await backend<{ sessionId: string; text: string; pending?: PendingConfirmation[] }>(
        "/chat/messages",
        {
          method: "POST",
          body: {
            text,
            ...(sessionId && sessionId !== "__new__" ? { sessionId } : {}),
            machineName: machineName || undefined,
          },
        },
      );
      setSessionId(result.sessionId);
      setPending(result.pending ?? []);
      setMessages((rows) => [
        ...rows,
        { role: "assistant", text: result.text },
      ]);
      setSessions((rows) => [
        {
          id: result.sessionId,
          preview: text,
          updatedAt: new Date().toISOString(),
        },
        ...rows.filter((row) => row.id !== result.sessionId),
      ]);
    } catch (cause) {
      setMessages((rows) => [
        ...rows,
        {
          role: "assistant",
          text:
            cause instanceof Error
              ? `Não consegui enviar: ${cause.message}`
              : "Não consegui enviar a mensagem.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function resolveConfirmation(item: PendingConfirmation, approved: boolean) {
    if (!sessionId || sessionId === "__new__") return;
    setLoading(true);
    try {
      const result = await backend<{ sessionId: string; text: string; pending?: PendingConfirmation[] }>(
        `/chat/sessions/${encodeURIComponent(sessionId)}/resolve`,
        { method: "POST", body: { tool: item.tool, ref: item.ref, approved, reason: approved ? undefined : "Recusado pelo usuário no aplicativo desktop." } },
      );
      setPending(result.pending ?? []);
      if (result.text) setMessages((rows) => [...rows, { role: "assistant", text: result.text }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível responder à solicitação.");
    } finally { setLoading(false); }
  }

  async function channelAction(
    channel: "whatsapp" | "telegram",
    action: string,
  ) {
    try {
      await request(`/v1/channels/${channel}/${action}`, { method: "POST" });
      await loadScreen();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A ação falhou.");
    }
  }

  async function logout() {
    await request("/v1/session/logout", { method: "POST" });
    setLoggedIn(false);
    setPayload(null);
  }

  async function mutateBackend(path: string, method: string, body?: unknown) {
    setError("");
    try {
      await (path.startsWith("/v1/") ? request(path, { method, body }) : backend(path, { method, body }));
      await loadScreen();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar as alterações.");
    }
  }

  if (starting)
    return (
      <div className="launch-state">
        <span className="brand-mark">h</span>
        <p>Preparando seu espaço…</p>
        <div className="progress-track">
          <span />
        </div>
      </div>
    );
  if (!loggedIn)
    return (
      <main className="auth-layout">
        <section className="auth-brand">
          <span className="brand-mark">h</span>
          <p className="eyebrow">ASSISTENTE PESSOAL</p>
          <h1>Seu trabalho, mais leve.</h1>
          <p>
            Converse com Helena, conecte seus canais e deixe as tarefas
            repetitivas com ela.
          </p>
          <div className="auth-orbit" aria-hidden="true">
            ✦
          </div>
        </section>
        <section className="auth-panel">
          <form className="auth-card" onSubmit={authenticate}>
            <p className="eyebrow">BEM-VINDO À HELENA</p>
            <h2>{registerMode ? "Crie sua conta" : "Entre na sua conta"}</h2>
            <p className="subtle">Use o mesmo acesso da sua conta Helena.</p>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete={
                  registerMode ? "new-password" : "current-password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={registerMode ? 8 : undefined}
              />
            </label>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={loading}>
              {loading ? "Aguarde…" : registerMode ? "Criar conta" : "Entrar"}
            </button>
            <button
              className="quiet-button"
              type="button"
              onClick={() => setRegisterMode((value) => !value)}
            >
              {registerMode ? "Já tenho uma conta" : "Criar conta"}
            </button>
          </form>
        </section>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">h</span>
          <strong>helena</strong>
          <small>DESKTOP</small>
        </div>
        <div className="workspace-label">SEU ESPAÇO</div>
        {["Operação", "Sistema", "Gestão"].map((group) => (
          <nav className="nav-group" aria-label={group} key={group}>
            <p>{group}</p>
            {navigation
              .filter((item) => item.group === group)
              .map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${screen === item.id ? "selected" : ""}`}
                  title={item.label}
                  onClick={() => navigateTo(item.id)}
                >
                  <span>{item.icon}</span>
                  {item.label}
                </button>
              ))}
          </nav>
        ))}
        <div className="sidebar-footer">
          <span className="online-dot" />
          Este computador conectado
          <button onClick={logout}>Sair da conta</button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">
              HELENA / {current.group.toUpperCase()}
            </span>
            <h1>{current.label}</h1>
          </div>
          <div className="profile-chip">
            <span className="profile-avatar">
              {email.slice(0, 1).toUpperCase() || "H"}
            </span>
            <span>{email || "Sua conta"}</span>
          </div>
        </header>
        <section
          className={`page-content ${screen === "chat" ? "chat-page" : ""}`}
        >
          {error && (
            <div className="notice error-notice" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Fechar aviso">
                ×
              </button>
            </div>
          )}
          {loading && screen !== "chat" ? (
            <div className="skeleton-stack" role="status">
              <div />
              <div />
              <div />
            </div>
          ) : null}
          {!loading && screen === "home" && (
            <Home payload={{ ...(payload ?? {}), channels: channelState ?? payload?.channels }} onOpen={navigateTo} />
          )}
          {!loading && screen === "chat" && (
            <Chat
              sessions={sessions}
              selected={sessionId}
              onSelect={(id) => { setSessionId(id); setPending([]); }}
              messages={messages}
              draft={draft}
              onDraft={setDraft}
              onSend={sendMessage}
              sending={sending}
              progress={chatProgress}
              pending={pending}
              onResolve={resolveConfirmation}
              onNew={() => {
                setSessionId("__new__");
                setMessages([]);
                setPending([]);
              }}
            />
          )}
          {!loading && screen === "channels" && (
            <Channels channels={channelState ?? payload} action={channelAction} token={telegramToken} onToken={setTelegramToken} onSaveToken={async () => {
              try { await request("/v1/channels/telegram/token", { method: "PUT", body: { token: telegramToken } }); setTelegramToken(""); await loadScreen(); }
              catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o token."); }
            }} onRemoveToken={async () => { try { await request("/v1/channels/telegram/token", { method: "DELETE" }); await loadScreen(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível remover o token."); } }} />
          )}
          {!loading && !["home", "chat", "channels", "rules", "contacts", "settings", "credits", "usage"].includes(screen) && (
            <DataScreen screen={screen} payload={payload} mutate={mutateBackend} />
          )}
          {!loading && screen === "rules" && <RulesScreen payload={payload} mutate={mutateBackend} />}
          {!loading && screen === "contacts" && <ContactsScreen contacts={payload} mutate={mutateBackend} />}
          {!loading && screen === "settings" && <SettingsScreen payload={payload} mutate={mutateBackend} />}
          {!loading && screen === "credits" && <CreditsScreen payload={payload} />}
          {!loading && screen === "usage" && <UsageScreen payload={payload} />}
        </section>
      </main>
    </div>
  );
}

function Home({
  payload,
  onOpen,
}: {
  payload: any;
  onOpen: (screen: Screen) => void;
}) {
  const machine = payload?.machine;
  const channels = payload?.channels ?? {};
  const balance = payload?.doctor?.billing ?? payload?.doctor?.balance;
  return (
    <div className="content-column">
      <div className="welcome-card">
        <div>
          <p className="eyebrow">VISÃO GERAL</p>
          <h2>Olá, {machine?.name || "bem-vindo de volta"}</h2>
          <p>Seu assistente está pronto para ajudar no computador.</p>
          <button className="primary-button" onClick={() => onOpen("chat")}>
            Começar uma conversa <span>→</span>
          </button>
        </div>
        <div className="welcome-art" aria-hidden="true">
          ✦
        </div>
      </div>
      <div className="section-title">
        <h2>Seu espaço</h2>
        <span>Atalhos para o que importa</span>
      </div>
      <div className="quick-grid">
        <button className="quick-card" onClick={() => onOpen("chat")}>
          <span className="quick-icon">◌</span>
          <strong>Conversas</strong>
          <small>Fale com Helena</small>
        </button>
        <button className="quick-card" onClick={() => onOpen("channels")}>
          <span className="quick-icon">↔</span>
          <strong>Canais</strong>
          <small>WhatsApp e Telegram</small>
        </button>
        <button className="quick-card" onClick={() => onOpen("contacts")}>
          <span className="quick-icon">♧</span>
          <strong>Contatos</strong>
          <small>Acessos e limites</small>
        </button>
      </div>
      <div className="section-title">
        <h2>Conexões locais</h2>
        <button className="text-action" onClick={() => onOpen("channels")}>
          Ver canais →
        </button>
      </div>
      <div className="status-grid">
        <StatusCard
          title="WhatsApp"
          status={channels.whatsapp?.status}
          detail={
            channels.whatsapp?.status === "connected"
              ? "Conectado neste computador"
              : "Aguardando conexão"
          }
        />
        <StatusCard
          title="Telegram"
          status={channels.telegram?.status}
          detail={
            channels.telegram?.tokenSet
              ? "Bot configurado"
              : "Configure seu bot para começar"
          }
        />
        <StatusCard
          title="Máquina"
          status={payload?.doctor?.ok ? "connected" : undefined}
          detail={machine?.platform || "Este computador"}
        />
      </div>
      <p className="footnote">
        Helena roda neste computador. Seus canais e arquivos permanecem sob seu
        controle.
      </p>
    </div>
  );
}

function StatusCard({
  title,
  status,
  detail,
}: {
  title: string;
  status?: string;
  detail: string;
}) {
  const online = ["connected", "open", "online", "ready"].includes(
    String(status).toLowerCase(),
  );
  return (
    <article className="status-card">
      <div className="status-card-top">
        <strong>{title}</strong>
        <span className={`status-pill ${online ? "positive" : ""}`}>
          <i /> {online ? "Conectado" : status || "Desconectado"}
        </span>
      </div>
      <p>{detail}</p>
    </article>
  );
}

function Channels({
  channels,
  action,
  token,
  onToken,
  onSaveToken,
  onRemoveToken,
}: {
  channels: any;
  action: (channel: "whatsapp" | "telegram", action: string) => void;
  token: string;
  onToken: (value: string) => void;
  onSaveToken: () => void;
  onRemoveToken: () => void;
}) {
  return (
    <div className="content-column">
      <p className="page-intro">
        Conecte seus canais para que Helena acompanhe mensagens e responda por
        você.
      </p>
      {(["whatsapp", "telegram"] as const).map((channel) => {
        const data = channels?.[channel] ?? {};
        const online = ["connected", "open", "online", "ready"].includes(
          String(data.status).toLowerCase(),
        );
        const connecting = ["connecting", "qr"].includes(String(data.status).toLowerCase());
        const active = online || connecting;
        return (
          <section className="channel-card" key={channel}>
            <div className="channel-icon">
              {channel === "whatsapp" ? "W" : "➤"}
            </div>
            <div className="channel-copy">
              <h2>{channel === "whatsapp" ? "WhatsApp" : "Telegram"}</h2>
              <p>
                {online
                  ? "Conectado e pronto para receber mensagens."
                  : "Ainda não conectado neste computador."}
              </p>
              {channel === "whatsapp" && data.status === "qr" && data.qrDataUrl && (
                <div className="whatsapp-pairing">
                  <img className="whatsapp-qr" src={data.qrDataUrl} alt="QR Code para conectar o WhatsApp" />
                  <p>Abra o WhatsApp no celular e escaneie este código em Dispositivos conectados.</p>
                </div>
              )}
              {channel === "whatsapp" && data.status === "qr" && !data.qrDataUrl && <p className="subtle">Gerando QR Code…</p>}
              {data.error && <p className="inline-error">{data.error}</p>}
              {channel === "telegram" && (
                <div className="channel-token-form">
                  <label htmlFor="telegram-token">Token do bot</label>
                  <input id="telegram-token" type="password" autoComplete="off" value={token} onChange={(event) => onToken(event.target.value)} placeholder={data.tokenSet ? "Token configurado · informe outro para trocar" : "Cole o token enviado pelo BotFather"} />
                  <button className="secondary-button" disabled={!token.trim()} onClick={onSaveToken}>Salvar token</button>
                  {data.tokenSet && <button className="quiet-button" onClick={onRemoveToken}>Remover token</button>}
                </div>
              )}
            </div>
            <div className="channel-actions">
                <span className={`status-pill ${online ? "positive" : ""}`}>
                <i />
                {online ? "Conectado" : connecting ? (data.status === "qr" ? "Aguardando leitura do QR" : "Conectando") : data.status || "Desconectado"}
              </span>
              <button
                className={active ? "secondary-button" : "primary-button"}
                onClick={() => action(channel, active ? "stop" : "start")}
              >
                {active ? (connecting ? "Cancelar conexão" : "Desconectar") : "Conectar"}
              </button>
            </div>
          </section>
        );
      })}
      <div className="notice">
        O pareamento acontece neste aplicativo. Mantenha o computador ligado
        para que os canais continuem ativos.
      </div>
    </div>
  );
}

function Chat({
  sessions,
  selected,
  onSelect,
  messages,
  draft,
  onDraft,
  onSend,
  sending,
  progress,
  pending,
  onResolve,
  onNew,
}: {
  sessions: SessionRow[];
  selected: string;
  onSelect: (id: string) => void;
  messages: MessageRow[];
  draft: string;
  onDraft: (text: string) => void;
  onSend: (event: React.FormEvent) => void;
  sending: boolean;
  progress: string;
  pending: PendingConfirmation[];
  onResolve: (item: PendingConfirmation, approved: boolean) => void;
  onNew: () => void;
}) {
  return (
    <div className="chat-layout">
      <aside className="chat-list">
        <div className="chat-list-header">
          <strong>Conversas</strong>
          <button aria-label="Nova conversa" onClick={onNew}>
            ＋
          </button>
        </div>
        {sessions.map((session) => (
          <button
            key={session.id}
            className={`chat-session ${selected === session.id ? "active" : ""}`}
            onClick={() => onSelect(session.id)}
          >
            <strong>{session.preview || "Nova conversa"}</strong>
            <small>
              {session.updatedAt
                ? new Date(session.updatedAt).toLocaleString("pt-BR")
                : ""}
            </small>
          </button>
        ))}
      </aside>
      <div className="chat-conversation">
        <div className="message-list">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <span>✦</span>
              <h2>Como posso ajudar?</h2>
              <p>Escreva uma mensagem para começar uma nova conversa.</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                key={`${message.createdAt ?? ""}-${index}`}
                className={`message ${message.role === "user" ? "from-user" : ""}`}
              >
                <span className="message-avatar">
                  {message.role === "user" ? "Você" : "h"}
                </span>
                <div className="message-body">
                  <strong>{message.role === "user" ? "Você" : "Helena"}</strong>
                  <p>{message.text}</p>
                </div>
              </article>
            ))
          )}
          {sending && (
            <div className="typing-indicator">
              <span />
              <span />
              <span /> {progress || "Helena está pensando…"}
            </div>
          )}
          {pending.map((item, index) => (
            <article className="approval-card" key={`${item.tool}-${item.ref ?? index}`}>
              <strong>Helena pede autorização</strong>
              <p><code>{item.tool}</code></p>
              <pre>{JSON.stringify(item.input, null, 2)}</pre>
              <div><button className="primary-button" onClick={() => onResolve(item, true)}>Permitir</button><button className="secondary-button" onClick={() => onResolve(item, false)}>Recusar</button></div>
            </article>
          ))}
        </div>
        <form className="composer" onSubmit={onSend}>
          <textarea
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            placeholder="Escreva para Helena…"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-footer">
            <span>Enter envia · Shift + Enter quebra a linha</span>
            <button
              className="primary-button"
              disabled={sending || !draft.trim()}
            >
              Enviar <span>↑</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RulesScreen({ payload, mutate }: { payload: any; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState<any>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [scopeValue, setScopeValue] = useState("channel:whatsapp");
  const [formError, setFormError] = useState("");
  const [audit, setAudit] = useState<any[] | null>(null);
  const rules = payload?.rules ?? [];
  const contacts = payload?.contacts ?? [];
  const integrations = payload?.integrations ?? [];
  function begin(rule?: any) {
    setEditing(rule ?? {});
    setValues({ ...ruleToFormValues(rule), enabled: rule?.enabled === false ? "n" : "s" });
    setScopeValue(rule?.scopeType === "contact" ? `contact:${rule.scopeContactId}` : `channel:${rule?.scopeChannel ?? "whatsapp"}`);
    setFormError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const scope: RuleScope = scopeValue.startsWith("contact:")
      ? (() => { const contact = contacts.find((item: any) => item.id === scopeValue.slice(8)); return { type: "contact", contactId: contact?.id, channel: contact?.channel, label: contact?.name ?? contact?.contactId }; })()
      : { type: "channel", channel: scopeValue.slice(8), label: `todos do ${scopeValue.slice(8)}` };
    const result = formValuesToRule(values, scope, integrations, !/^\s*n/i.test(values.enabled ?? "s"));
    if (!result.input) { setFormError(result.errors.join(" ")); return; }
    await mutate(editing?.id ? `/contact-rules/${encodeURIComponent(editing.id)}` : "/contact-rules", editing?.id ? "PATCH" : "POST", result.input);
    setEditing(null);
  }
  if (editing !== null) return <div className="content-column"><button className="text-action" onClick={() => setEditing(null)}>← Voltar às regras</button>
    <form className="rule-editor" onSubmit={save}>
      <div><p className="eyebrow">PERMISSÕES E PROTEÇÕES</p><h2>{editing.id ? "Editar regra" : "Nova regra de atendimento"}</h2><p className="subtle">As permissões são aplicadas pelo sistema. Deixe em branco o que não deseja liberar.</p></div>
      <label>Esta regra vale para<select value={scopeValue} onChange={(event) => setScopeValue(event.target.value)}><option value="channel:whatsapp">Todos os contatos do WhatsApp</option><option value="channel:telegram">Todos os contatos do Telegram</option>{contacts.map((contact: any) => <option key={contact.id} value={`contact:${contact.id}`}>{contact.name || contact.contactId} ({contact.channel})</option>)}</select></label>
      <label>Nome da regra<input required value={values.name ?? ""} onChange={(event) => setValues({ ...values, name: event.target.value })} /></label>
      <label>Para que serve<textarea value={values.task ?? ""} onChange={(event) => setValues({ ...values, task: event.target.value })} /></label>
      <label>Quando pode ser usada<textarea value={values.condition ?? ""} onChange={(event) => setValues({ ...values, condition: event.target.value })} /></label>
      <label>O que Helena nunca deve fazer<textarea value={values.forbidden ?? ""} onChange={(event) => setValues({ ...values, forbidden: event.target.value })} /></label>
      <fieldset><legend>Agenda e notas</legend>
        <CheckField label="Pode criar compromissos" name="calCreate" values={values} setValues={setValues} /><CheckField label="Pode consultar horários livres" name="calAvail" values={values} setValues={setValues} /><CheckField label="Só marcar em horário livre" name="calOnlyFree" values={values} setValues={setValues} /><CheckField label="Pode deixar recados nas notas" name="notes" values={values} setValues={setValues} /><CheckField label="Avisar quando criar ou gravar algo" name="notify" values={values} setValues={setValues} />
        <label>Máximo de compromissos por dia<input type="number" min="1" max="20" value={values.calPerDay ?? "1"} onChange={(event) => setValues({ ...values, calPerDay: event.target.value })} /></label>
      </fieldset>
      <fieldset><legend>Arquivos e integrações</legend>
        <label>Nome desta máquina<input value={values.machine ?? ""} onChange={(event) => setValues({ ...values, machine: event.target.value })} /></label>
        <label>Pastas que pode ler<input value={values.readDirs ?? ""} placeholder="Caminhos completos, separados por vírgula" onChange={(event) => setValues({ ...values, readDirs: event.target.value })} /></label>
        <label>Tipos de arquivo que pode ler<input value={values.readExts ?? ""} placeholder="pdf, xlsx" onChange={(event) => setValues({ ...values, readExts: event.target.value })} /></label>
        <label>Pastas onde pode gravar<input value={values.writeDirs ?? ""} onChange={(event) => setValues({ ...values, writeDirs: event.target.value })} /></label>
        <label>Tipos de arquivo que pode gravar<input value={values.writeExts ?? ""} placeholder="txt, csv" onChange={(event) => setValues({ ...values, writeExts: event.target.value })} /></label>
        <label>Pastas sempre proibidas<input value={values.deniedDirs ?? ""} onChange={(event) => setValues({ ...values, deniedDirs: event.target.value })} /></label>
        <label>Integração MCP<select value={values.mcpConnection ?? ""} onChange={(event) => setValues({ ...values, mcpConnection: event.target.value })}><option value="">Nenhuma</option>{integrations.map((item: any) => <option key={item.id} value={item.name}>{item.name}</option>)}</select></label>
        <label>Ferramentas liberadas<input value={values.mcpTools ?? ""} placeholder="nomes separados por vírgula" onChange={(event) => setValues({ ...values, mcpTools: event.target.value })} /></label>
      </fieldset>
      <fieldset><legend>Dados que nunca devem aparecer nas respostas</legend>
        <label>Tipos prontos<input value={values.presets ?? ""} placeholder="CPF, email, telefone, pix" onChange={(event) => setValues({ ...values, presets: event.target.value })} /></label>
        <label>Termos proibidos<input value={values.terms ?? ""} onChange={(event) => setValues({ ...values, terms: event.target.value })} /></label>
        <label>Modelos proibidos<input value={values.templates ?? ""} placeholder="Exemplo: PED-####" onChange={(event) => setValues({ ...values, templates: event.target.value })} /></label>
      </fieldset>
      <CheckField label="Regra ativa" name="enabled" values={values} setValues={setValues} />
      {formError && <p className="inline-error">{formError}</p>}
      <div className="rule-actions"><button className="primary-button">Salvar regra</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancelar</button></div>
    </form>
  </div>;
  return <div className="content-column"><div className="section-title"><div><h2>Regras de atendimento</h2><span>Defina o que contatos podem fazer pela Helena</span></div><button className="primary-button" onClick={() => begin()}>＋ Nova regra</button></div>
    <p className="page-intro">Permissões de ferramentas, arquivos e dados protegidos para WhatsApp e Telegram.</p>
    {rules.length ? <div className="data-list">{rules.map((rule: any) => <article className="data-card rule-row" key={rule.id}><div className="rule-row-copy"><strong>{rule.name}</strong><p>{rule.scopeType === "contact" ? contacts.find((c: any) => c.id === rule.scopeContactId)?.name ?? "Contato" : `Todos do ${rule.scopeChannel ?? "WhatsApp"}`} · {rule.enabled ? "Ativa" : "Desativada"}</p></div><button className="secondary-button" onClick={() => begin(rule)}>Editar</button><button className="secondary-button" onClick={() => void mutate(`/contact-rules/${encodeURIComponent(rule.id)}`, "PATCH", { enabled: !rule.enabled })}>{rule.enabled ? "Desativar" : "Ativar"}</button><button className="quiet-button" onClick={() => { if (window.confirm(`Excluir a regra “${rule.name}”?`)) void mutate(`/contact-rules/${encodeURIComponent(rule.id)}`, "DELETE"); }}>Excluir</button></article>)}</div> : <div className="empty-panel"><h2>Nenhuma regra criada</h2><p>Crie uma regra para definir as permissões de atendimento.</p><button className="primary-button" onClick={() => begin()}>Criar primeira regra</button></div>}
    <div className="section-title"><h2>Atividade das regras</h2><button className="text-action" onClick={() => void backend<any[]>("/contact-rules/audit?limit=30").then(setAudit).catch((cause) => setFormError(cause.message))}>Carregar auditoria</button></div>
    {audit && <div className="data-list">{audit.map((entry) => <article className="data-card" key={entry.id}><strong>{entry.senderName || entry.contactId || "Contato"}</strong><p>{entry.toolName || entry.kind} · {entry.outcome}{entry.reason ? ` · ${entry.reason}` : ""}</p><span>{new Date(entry.createdAt).toLocaleString("pt-BR")}</span></article>)}</div>}
  </div>;
}

function CheckField({ label, name, values, setValues }: { label: string; name: string; values: Record<string, string>; setValues: (values: Record<string, string>) => void }) {
  const enabled = /^s(im)?$/i.test(values[name] ?? "n");
  return <label className="check-field"><input type="checkbox" checked={enabled} onChange={(event) => setValues({ ...values, [name]: event.target.checked ? "s" : "n" })} />{label}</label>;
}

function SettingsScreen({ payload, mutate }: { payload: any; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  const user = payload?.user ?? {};
  const config = payload?.config?.effective ?? payload?.config?.file ?? payload?.config ?? {};
  const [local, setLocal] = useState({ machineName: config.machineName ?? "", allowedDirs: (config.allowedDirs ?? []).join(", "), deniedPaths: (config.deniedPaths ?? []).join(", "), backgroundShellTimeoutMinutes: String(config.backgroundShellTimeoutMinutes ?? 30), mediaMaxMb: String(config.mediaMaxMb ?? 20) });
  return <div className="content-column"><p className="page-intro">Preferências da conta e deste computador.</p>
    <section className="data-panel"><h2>Preferências da conta</h2><div className="settings-toggles">
      <CheckField label="Permitir telemetria de uso anônima" name="telemetryConsent" values={{ telemetryConsent: user.telemetryConsent ? "s" : "n" }} setValues={(v) => void mutate("/auth/me/telemetry-consent", "PATCH", { consent: v.telemetryConsent === "s" })} />
      <CheckField label="Aprovar automaticamente comandos do terminal" name="autoApproveShell" values={{ autoApproveShell: user.autoApproveShell ? "s" : "n" }} setValues={(v) => void mutate("/auth/me/auto-approve-shell", "PATCH", { enabled: v.autoApproveShell === "s" })} />
      <CheckField label="Permitir mensagens proativas" name="allowProactiveMessages" values={{ allowProactiveMessages: user.allowProactiveMessages ? "s" : "n" }} setValues={(v) => void mutate("/auth/me/allow-proactive-messages", "PATCH", { enabled: v.allowProactiveMessages === "s" })} />
    </div><div className="owner-identities"><label>Seu número do WhatsApp<input defaultValue={user.whatsappOwnerNumber ?? ""} placeholder="55…" onBlur={(e) => e.target.value.trim() && void mutate("/auth/me/owner-identity", "PATCH", { channel: "whatsapp", contactId: e.target.value })} /></label><label>Seu ID do Telegram<input defaultValue={user.telegramOwnerId ?? ""} placeholder="ID numérico" onBlur={(e) => e.target.value.trim() && void mutate("/auth/me/owner-identity", "PATCH", { channel: "telegram", contactId: e.target.value })} /></label></div></section>
    <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void mutate("/v1/config", "PATCH", { ...(local.machineName.trim() ? { machineName: local.machineName.trim() } : {}), allowedDirs: local.allowedDirs.split(",").map((x) => x.trim()).filter(Boolean), deniedPaths: local.deniedPaths.split(",").map((x) => x.trim()).filter(Boolean), backgroundShellTimeoutMinutes: Number(local.backgroundShellTimeoutMinutes), mediaMaxMb: Number(local.mediaMaxMb) }); }}>
      <h2>Este computador</h2><p>O servidor central e o serviço Express local são configurados pelo aplicativo.</p><label>Nome da máquina<input value={local.machineName} onChange={(e) => setLocal({ ...local, machineName: e.target.value })} /></label><label>Pastas permitidas<input placeholder="Caminhos absolutos separados por vírgula" value={local.allowedDirs} onChange={(e) => setLocal({ ...local, allowedDirs: e.target.value })} /></label><label>Caminhos bloqueados<input placeholder="Separados por vírgula" value={local.deniedPaths} onChange={(e) => setLocal({ ...local, deniedPaths: e.target.value })} /></label><label>Tempo limite do terminal em minutos<input type="number" min="1" max="720" value={local.backgroundShellTimeoutMinutes} onChange={(e) => setLocal({ ...local, backgroundShellTimeoutMinutes: e.target.value })} /></label><label>Tamanho máximo de mídia em MB<input type="number" min="1" max="200" value={local.mediaMaxMb} onChange={(e) => setLocal({ ...local, mediaMaxMb: e.target.value })} /></label><button className="primary-button">Salvar preferências locais</button>
    </form><div className="section-title"><h2>Sessões da conta</h2></div><div className="data-list">{(payload?.sessions ?? []).map((session: any, index: number) => <article className="data-card" key={session.id ?? index}><div className="rule-row-copy"><strong>{session.deviceLabel || session.userAgent || "Sessão ativa"}</strong><p>{session.createdAt ? new Date(session.createdAt).toLocaleString("pt-BR") : ""}</p></div>{session.current && <span>Sessão atual</span>}</article>)}</div>
  </div>;
}

function CreditsScreen({ payload }: { payload: any }) {
  const [balance, setBalance] = useState(payload?.balance ?? {});
  const [purchase, setPurchase] = useState<any>(null);
  const [redeemed, setRedeemed] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"" | "purchase" | "coupon" | "limit">("");
  const [amount, setAmount] = useState("20");
  const [taxId, setTaxId] = useState("");
  const [coupon, setCoupon] = useState("");
  const [limit, setLimit] = useState(String(balance.defaultContactMonthlyLimitBrl ?? 0));
  async function refreshBalance() { const next = await backend<any>("/billing/balance"); setBalance(next); setLimit(String(next.defaultContactMonthlyLimitBrl ?? 0)); }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (mode === "purchase") {
        const rawAmount = amount.trim().replace(/[R$\s]/g, "");
        const valueBrl = Number(rawAmount.includes(",") ? rawAmount.replace(/\./g, "").replace(",", ".") : rawAmount);
        const cpfCnpj = taxId.replace(/\D/g, "");
        if (valueBrl < 5 || valueBrl > 1000) throw new Error("Informe um valor entre R$ 5 e R$ 1.000.");
        if (cpfCnpj.length < 11) throw new Error("Informe um CPF ou CNPJ válido.");
        setPurchase(await backend("/billing/purchase", { method: "POST", body: { valueBrl, cpfCnpj } }));
      } else if (mode === "coupon") {
        if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(coupon.trim())) throw new Error("Use o formato XXXX-XXXX para o código do cupom.");
        setRedeemed(await backend("/coupons/redeem", { method: "POST", body: { code: coupon.trim().toUpperCase() } }));
      } else if (mode === "limit") {
        await backend("/billing/contact-limit", { method: "PATCH", body: { defaultMonthlyLimitBrl: Number(limit.replace(",", ".")) } });
      }
      await refreshBalance(); setMode("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação."); }
    finally { setBusy(false); }
  }
  async function cancelPurchase() { setBusy(true); try { await backend("/billing/purchase/cancel", { method: "POST" }); setPurchase(null); await refreshBalance(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível cancelar a cobrança."); } finally { setBusy(false); } }
  return <div className="content-column"><p className="page-intro">Saldo de créditos usados para as mensagens e ferramentas da Helena.</p>
    <div className="metric-grid"><article className="metric-card accent"><span>Saldo disponível</span><strong>R$ {Number(balance.creditBrl ?? 0).toFixed(2).replace(".", ",")}</strong></article><article className="metric-card"><span>Créditos recebidos</span><strong>R$ {Number(balance.totalGrantedBrl ?? 0).toFixed(2).replace(".", ",")}</strong></article><article className="metric-card"><span>Total comprado</span><strong>R$ {Number(balance.totalPurchasedBrl ?? 0).toFixed(2).replace(".", ",")}</strong></article></div>
    <section className="data-panel"><h2>Limite mensal para contatos</h2><p>Limite padrão de gastos dos contatos nos canais: <strong>R$ {Number(balance.defaultContactMonthlyLimitBrl ?? 0).toFixed(2).replace(".", ",")}</strong></p><button className="secondary-button" onClick={() => setMode("limit")}>Alterar limite</button></section>
    <div className="billing-actions"><button className="primary-button" disabled={balance.hasPendingPayment} onClick={() => setMode("purchase")}>Comprar créditos</button><button className="secondary-button" onClick={() => setMode("coupon")}>Resgatar cupom</button>{balance.hasPendingPayment && <button className="quiet-button" disabled={busy} onClick={() => void cancelPurchase()}>Cancelar cobrança pendente</button>}</div>
    {payload?.coupons?.length > 0 && <section className="data-panel"><h2>Cupons disponíveis</h2>{payload.coupons.map((item: any) => <p key={item.id}><strong>{item.code}</strong> · R$ {Number(item.creditBrl).toFixed(2).replace(".", ",")} · {item.confirmationMessage}</p>)}</section>}
    {mode && <form className="inline-form" onSubmit={(event) => void submit(event)}><h2>{mode === "purchase" ? "Comprar créditos" : mode === "coupon" ? "Resgatar cupom" : "Limite mensal por contato"}</h2>{mode === "purchase" && <><label>Valor em reais (R$ 5 a R$ 1.000)<input required value={amount} onChange={(e) => setAmount(e.target.value)} /></label><label>CPF/CNPJ<input required value={taxId} onChange={(e) => setTaxId(e.target.value)} /></label></>}{mode === "coupon" && <label>Código do cupom<input required value={coupon} placeholder="XXXX-XXXX" onChange={(e) => setCoupon(e.target.value.toUpperCase())} /></label>}{mode === "limit" && <label>Valor mensal em reais<input required type="number" min="0" step="0.01" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>}{error && <p className="inline-error">{error}</p>}<div className="rule-actions"><button className="primary-button" disabled={busy}>{busy ? "Aguarde…" : "Confirmar"}</button><button type="button" className="secondary-button" onClick={() => setMode("")}>Cancelar</button></div></form>}
    {purchase && <section className="data-panel"><h2>Pagamento iniciado</h2><p>Conclua o pagamento para adicionar R$ {Number(purchase.valueBrl).toFixed(2).replace(".", ",")} ao saldo.</p>{purchase.pixPayload && <><label>Pix copia e cola<textarea readOnly value={purchase.pixPayload} /></label><button className="secondary-button" onClick={() => void navigator.clipboard?.writeText(purchase.pixPayload)}>Copiar código Pix</button></>}{purchase.invoiceUrl && <button className="primary-button" onClick={() => void window.helena?.openExternal(purchase.invoiceUrl)}>Abrir página de pagamento</button>}</section>}
    {redeemed && <div className="notice">Cupom resgatado: R$ {Number(redeemed.creditBrl).toFixed(2).replace(".", ",")} · Novo saldo: R$ {Number(redeemed.newBalanceBrl).toFixed(2).replace(".", ",")}. {redeemed.confirmationMessage}</div>}
    <section className="data-panel"><h2>Como funciona</h2><p>Cada mensagem desconta o custo da IA mais 10%. Você vê o saldo e os limites antes de comprar ou alterar qualquer valor.</p>{payload?.rate && <p>Dólar: R$ {Number(payload.rate.usdBrlRate).toFixed(4).replace(".", ",")} · Cotação atualizada automaticamente.</p>}</section>
  </div>;
}

function UsageScreen({ payload }: { payload: any }) {
  const summary = Array.isArray(payload) ? payload[0] : payload;
  const entries = Array.isArray(payload) ? payload[1] : [];
  const metrics = summary && typeof summary === "object" ? Object.entries(summary).filter(([, value]) => ["string", "number"].includes(typeof value)) : [];
  return <div className="content-column"><p className="page-intro">Consumo recente da sua conta.</p><div className="metric-grid">{metrics.map(([label, value]) => <article className="metric-card" key={label}><span>{label.replace(/([A-Z])/g, " $1")}</span><strong>{typeof value === "number" ? value.toLocaleString("pt-BR") : String(value)}</strong></article>)}</div><div className="section-title"><h2>Mensagens recentes</h2></div>{entries?.length ? <div className="data-list">{entries.map((entry: any, index: number) => <article className="data-card" key={entry.id ?? index}><div className="rule-row-copy"><strong>{entry.model || entry.channel || "Mensagem"}</strong><p>{entry.createdAt ? new Date(entry.createdAt).toLocaleString("pt-BR") : ""}</p></div><span>{entry.costBrl != null ? `R$ ${Number(entry.costBrl).toFixed(4).replace(".", ",")}` : entry.tokens != null ? `${entry.tokens} tokens` : ""}</span></article>)}</div> : <div className="empty-panel"><h2>Sem registros recentes</h2><p>O histórico de uso aparecerá aqui conforme você conversar com Helena.</p></div>}</div>;
}

function ContactsScreen({ contacts: inputContacts, mutate }: { contacts: any[] | null | undefined; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  // On Chat -> Contacts, the chat load intentionally leaves the shared
  // payload null. The contacts request starts after render, so normalize
  // that interim state before reading length/map.
  const contacts = Array.isArray(inputContacts) ? inputContacts : [];
  const [selected, setSelected] = useState<any>(null);
  const [draft, setDraft] = useState<any>({});
  const [history, setHistory] = useState<any[] | null>(null);
  function edit(contact: any) { setSelected(contact); setDraft({ name: contact.name ?? "", relationship: contact.relationship ?? "", organization: contact.organization ?? "", notes: contact.notes ?? "", monthlyLimitBrl: contact.monthlyLimitBrl == null ? "" : String(contact.monthlyLimitBrl), grantedTools: contact.grantedTools ?? [] }); setHistory(null); }
  if (selected) return <div className="content-column"><button className="text-action" onClick={() => setSelected(null)}>← Voltar aos contatos</button><form className="rule-editor" onSubmit={(event) => { event.preventDefault(); const limit = draft.monthlyLimitBrl.trim() ? Number(draft.monthlyLimitBrl.replace(",", ".")) : null; void mutate(`/contacts/${encodeURIComponent(selected.id)}`, "PATCH", { ...draft, monthlyLimitBrl: limit }); setSelected(null); }}>
    <div><p className="eyebrow">{selected.channel?.toUpperCase()} · {selected.contactId}</p><h2>{selected.name || "Contato"}</h2><p className="subtle">Edite os detalhes e os acessos deste contato.</p></div>
    <label>Nome<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
    <label>Relacionamento<input value={draft.relationship} onChange={(event) => setDraft({ ...draft, relationship: event.target.value })} /></label>
    <label>Organização<input value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} /></label>
    <label>Observações<textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></label>
    <fieldset><legend>Ferramentas liberadas</legend>{(["notes", "tasks", "events"] as const).map((tool) => <label className="check-field" key={tool}><input type="checkbox" checked={draft.grantedTools.includes(tool)} onChange={(event) => setDraft({ ...draft, grantedTools: event.target.checked ? [...draft.grantedTools, tool] : draft.grantedTools.filter((value: string) => value !== tool) })} />{{ notes: "Notas", tasks: "Tarefas", events: "Agenda" }[tool]}</label>)}</fieldset>
    <label>Limite mensal próprio em reais<input type="number" min="0" step="0.01" placeholder={`Padrão: R$ ${selected.effectiveLimitBrl ?? "—"}`} value={draft.monthlyLimitBrl} onChange={(event) => setDraft({ ...draft, monthlyLimitBrl: event.target.value })} /></label>
    <div className="rule-actions"><button className="primary-button">Salvar contato</button><button type="button" className="secondary-button" onClick={() => setSelected(null)}>Cancelar</button><button type="button" className="text-action" onClick={() => void backend<any>(`/contacts/${encodeURIComponent(selected.id)}/history?limit=30`).then((result) => setHistory(result.entries ?? [])).catch(() => setHistory([]))}>Carregar histórico</button></div>
    {history && <div className="contact-history">{history.length ? history.map((item, index) => <article className={`message ${item.role === "user" ? "from-user" : ""}`} key={`${item.createdAt}-${index}`}><strong>{item.role === "user" ? "Contato" : "Helena"}</strong><p>{item.text}</p></article>) : <p className="subtle">Nenhuma mensagem no histórico.</p>}</div>}
  </form></div>;
  return <div className="content-column"><p className="page-intro">Pessoas que já conversaram com Helena. Gerencie detalhes, permissões e limites.</p>{contacts.length ? <div className="data-list">{contacts.map((contact) => <article className="data-card" key={contact.id}><div className="rule-row-copy"><strong>{contact.name || contact.contactId}</strong><p>{contact.channel} · {contact.contactId}</p><span>Gasto neste mês: R$ {Number(contact.spentThisMonthBrl ?? 0).toFixed(2)} · Limite: R$ {Number(contact.effectiveLimitBrl ?? 0).toFixed(2)}</span></div><button className="secondary-button" onClick={() => edit(contact)}>Detalhes</button></article>)}</div> : <div className="empty-panel"><h2>Nenhum contato ainda</h2><p>Os contatos aparecem quando alguém envia uma mensagem por um canal conectado.</p></div>}</div>;
}

function DataScreen({ screen, payload, mutate }: { screen: Screen; payload: any; mutate: (path: string, method: string, body?: unknown) => Promise<void> }) {
  const titles: Record<Screen, [string, string]> = {
    home: ["Painel", ""],
    chat: ["Conversas", ""],
    channels: ["Canais", ""],
    contacts: ["Contatos", "Pessoas que já conversaram com Helena."],
    rules: [
      "Regras de atendimento",
      "Permissões e limites que você definiu para seus contatos.",
    ],
    integrations: [
      "Integrações",
      "Servidores MCP configurados para sua conta.",
    ],
    credits: [
      "Créditos e limites",
      "Acompanhe o saldo e controle os gastos da Helena.",
    ],
    usage: ["Uso", "Veja o consumo da sua conta."],
    settings: ["Configurações", "Gerencie sua sessão e preferências."],
  };
  const [title, description] = titles[screen];
  const rows = Array.isArray(payload) ? payload : null;
  const [draft, setDraft] = useState({ name: "", serverUrl: "", authToken: "", machine: "" });
  return (
    <div className="content-column">
      <p className="page-intro">{description}</p>
      {screen === "integrations" && <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void mutate("/mcp-connections", "POST", { ...draft, enabled: true }); setDraft({ name: "", serverUrl: "", authToken: "", machine: "" }); }}>
        <h2>Adicionar integração MCP</h2>
        <label>Nome<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>Endereço do servidor<input required type="url" placeholder="https://… ou http://localhost:…" value={draft.serverUrl} onChange={(event) => setDraft({ ...draft, serverUrl: event.target.value })} /></label>
        <label>Token de acesso (opcional)<input type="password" autoComplete="new-password" value={draft.authToken} onChange={(event) => setDraft({ ...draft, authToken: event.target.value })} /></label>
        <label>Máquina local (opcional)<input placeholder="Nome deste computador" value={draft.machine} onChange={(event) => setDraft({ ...draft, machine: event.target.value })} /></label>
        <button className="primary-button">Adicionar integração</button>
      </form>}
      {rows?.length ? (
        <div className="data-list">
          {rows.map((row: any, index: number) => (
            <article
              className="data-card"
              key={row.id ?? row.contactId ?? index}
            >
              <strong>
                {row.name || row.preview || row.code || row.id || title}
              </strong>
              <p>
                {row.channel ||
                  row.scopeType ||
                  row.serverUrl ||
                  row.confirmationMessage ||
                  "Detalhes disponíveis"}
              </p>
              <span>
                {row.enabled === false ? "Desativado" : row.status || ""}
              </span>
              {screen === "contacts" && <button className="secondary-button" onClick={() => {
                const name = window.prompt("Nome do contato", row.name ?? "");
                if (name !== null) void mutate(`/contacts/${encodeURIComponent(row.id)}`, "PATCH", { name });
              }}>Editar nome</button>}
              {screen === "integrations" && <>
                <button className="secondary-button" onClick={() => void mutate(`/mcp-connections/${encodeURIComponent(row.id)}`, "PATCH", { enabled: !row.enabled })}>{row.enabled ? "Desativar" : "Ativar"}</button>
                <button className="quiet-button" onClick={() => { if (window.confirm(`Remover a integração ${row.name}?`)) void mutate(`/mcp-connections/${encodeURIComponent(row.id)}`, "DELETE"); }}>Remover</button>
              </>}
              {screen === "rules" && <button className="secondary-button" onClick={() => void mutate(`/contact-rules/${encodeURIComponent(row.id)}`, "PATCH", { enabled: !row.enabled })}>{row.enabled ? "Desativar" : "Ativar"}</button>}
            </article>
          ))}
        </div>
      ) : (
        <section className="data-panel">
          <h2>{title}</h2>
          <pre>{JSON.stringify(payload ?? {}, null, 2)}</pre>
        </section>
      )}
    </div>
  );
}
