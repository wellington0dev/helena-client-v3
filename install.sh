#!/usr/bin/env bash
# Instalador do client/ (WhatsApp/Telegram, painel local, execução de
# comando remoto — tudo num processo só, ver src/main.ts) via systemd
# --user. Idempotente / re-executável.
#
# Uso: ./install.sh

set -euo pipefail

CLIENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEMD_SRC="$CLIENT_DIR/systemd"
SYSTEMD_DEST="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ENV_FILE="$CLIENT_DIR/.env"
ENV_EXAMPLE="$CLIENT_DIR/.env.example"

source "$CLIENT_DIR/scripts/lib-env.sh"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
err()  { printf '\033[31m  x %s\033[0m\n' "$1" >&2; }
ok()   { printf '\033[32m  v %s\033[0m\n' "$1"; }

# --- preflight ---
NODE_BIN="$(command -v node || true)"
[[ -n "$NODE_BIN" ]] || { err "node não encontrado no PATH."; exit 1; }
command -v npm >/dev/null || { err "npm não encontrado no PATH."; exit 1; }

# --- dependências ---
bold "Instalando dependências (npm install)..."
( cd "$CLIENT_DIR" && npm install )

# --- painel web (Angular) — DESABILITADO (2026-09-17), CLI é a interface
# principal agora. O código-fonte continua em panel-app/, intacto, pra
# quem quiser retomar o desenvolvimento dele depois (ver
# client/docs/local-server-api.md pra API que ele consumia). Pra voltar a
# servir o painel: rode `npm run build:panel` manualmente e reverta o
# `startPanelServer` em `src/panel/server.ts` pra servir os arquivos de
# `panel-app/dist/panel-app/browser` de novo (ver histórico do git).

# --- .env ---
if [[ ! -f "$ENV_FILE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    warn ".env criado a partir de .env.example."
fi

# --- valida campos obrigatórios ---
# BACKEND_V2_API_TOKEN NÃO é obrigatório aqui de propósito (mudou
# 2026-09-16): era um loop sem saída — esse campo só se gera logando no
# painel, autenticado, mas o painel só existe DEPOIS deste script instalar
# e subir o serviço. Sem ele, o client sobe do mesmo jeito (painel de pé,
# WhatsApp/Telegram/execução remota ficam "aguardando login" — ver
# device-auth.ts) — o primeiro login (painel OU `helena` CLI) provisiona
# esse token sozinho, sem precisar copiar/colar nada.
MISSING=()
[[ -z "$(read_env "$ENV_FILE" BACKEND_V2_URL)" ]] && MISSING+=("BACKEND_V2_URL")

if [[ ${#MISSING[@]} -gt 0 ]]; then
    warn "Preencha estes campos em $ENV_FILE e rode ./install.sh de novo:"
    for m in "${MISSING[@]}"; do info "- $m"; done
    exit 0
fi

# --- comando global 'helena' (chat) ---
bold "Instalando o comando 'helena' (chat)..."
bash "$CLIENT_DIR/scripts/link-helena.sh"

# --- unit systemd --user ---
bold "Instalando o serviço systemd --user..."
mkdir -p "$SYSTEMD_DEST"
sed -e "s|@NODE@|$NODE_BIN|g" -e "s|@WORKDIR@|$CLIENT_DIR|g" \
    "$SYSTEMD_SRC/helena-client.service" > "$SYSTEMD_DEST/helena-client.service"
NOTIFY_BIN="$(command -v notify-send || echo /usr/bin/notify-send)"
sed -e "s|@NOTIFYSEND@|$NOTIFY_BIN|g" \
    "$SYSTEMD_SRC/helena-notify-fail@.service" > "$SYSTEMD_DEST/helena-notify-fail@.service"
systemctl --user daemon-reload
ok "Unit instalado em $SYSTEMD_DEST"

# --- linger: roda mesmo sem sessão gráfica ativa / após reboot ---
if ! loginctl show-user "$USER" 2>/dev/null | grep -q "Linger=yes"; then
    if loginctl enable-linger "$USER" 2>/dev/null; then
        ok "linger habilitado (o serviço sobrevive a logout/reboot)."
    else
        warn "Não consegui habilitar linger. Rode manualmente: sudo loginctl enable-linger $USER"
    fi
fi

# --- enable/start ---
if systemctl --user enable --now helena-client.service; then
    ok "helena-client habilitado e iniciado."
else
    err "falha ao habilitar helena-client — cheque: systemctl --user status helena-client"
fi

bold "Instalação concluída."
if [[ -z "$(read_env "$ENV_FILE" BACKEND_V2_API_TOKEN)" ]]; then
    info "Falta só um login pra ativar WhatsApp/Telegram/execução remota — rode 'helena', cadastre-se ou entre, depois digite /canais pra parear o WhatsApp escaneando o QR (aparece direto no terminal). O token de longa duração é gerado sozinho nesse login, sem precisar mexer no .env."
else
    info "Rode 'helena' e digite /canais pra parear o WhatsApp escaneando o QR (aparece direto no terminal)."
fi
info "'helena' já está disponível — teste com: helena --help"
