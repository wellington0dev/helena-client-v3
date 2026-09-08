#!/usr/bin/env bash
# Atualiza o client/ a partir do git (branch atual, fast-forward only),
# reinstala dependências, rebuilda o painel web e reinicia o serviço
# systemd --user instalado por ./install.sh. SEMPRE builda e reinicia no
# final, mesmo sem nenhum commit novo pra puxar (útil pra forçar reiniciar
# com o código atual, sem depender de ter algo novo no git) — só o "puxar
# do git" em si é pulado quando já está atualizado. Idempotente /
# re-executável. Mesma lógica de backend-v2/update.sh.
#
# Uso: ./update.sh

set -euo pipefail

CLIENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$CLIENT_DIR/.env"
SERVICE="helena-client.service"

source "$CLIENT_DIR/scripts/lib-env.sh"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
err()  { printf '\033[31m  x %s\033[0m\n' "$1" >&2; }
ok()   { printf '\033[32m  v %s\033[0m\n' "$1"; }

cd "$CLIENT_DIR"

# --- preflight ---
command -v git >/dev/null || { err "git não encontrado no PATH."; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { err "$CLIENT_DIR não é um repo git."; exit 1; }

# --- não pisa em trabalho não commitado ---
if [[ -n "$(git status --porcelain)" ]]; then
    err "Há mudanças não commitadas em $CLIENT_DIR — abortando pra não perder nada."
    info "Commite/stash suas mudanças (git stash -u) e rode ./update.sh de novo."
    exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BEFORE_SHA="$(git rev-parse HEAD)"

bold "Buscando atualizações (branch: $BRANCH)..."
git fetch origin "$BRANCH"

AHEAD_BEHIND="$(git rev-list --left-right --count "HEAD...origin/$BRANCH")"
BEHIND="$(awk '{print $2}' <<< "$AHEAD_BEHIND")"

if [[ "$BEHIND" == "0" ]]; then
    ok "Já está atualizado (nada novo em origin/$BRANCH) — builda e reinicia com o código atual mesmo assim."
else
    bold "Aplicando $BEHIND commit(s) novo(s) (fast-forward)..."
    if ! git merge --ff-only "origin/$BRANCH"; then
        err "Fast-forward falhou — seu HEAD divergiu de origin/$BRANCH."
        info "Resolva manualmente (rebase/merge) e rode ./update.sh de novo. Nada foi tocado."
        exit 1
    fi
    ok "Atualizado: $(git rev-parse --short "$BEFORE_SHA") → $(git rev-parse --short HEAD)"
fi

# --- dependências (só o que mudou, npm decide) ---
bold "Atualizando dependências (npm install)..."
npm install

# --- painel web (Angular) — só reinicia o serviço se o build for limpo ---
bold "Buildando o painel web (Angular)..."
if ! npm run build:panel; then
    err "Build do painel falhou depois do update — o serviço ANTIGO continua rodando, nada foi reiniciado."
    info "Corrija o erro acima. Pra voltar ao commit anterior: git reset --hard $BEFORE_SHA && ./update.sh"
    exit 1
fi
ok "Build limpo."

# --- comando global 'helena' (chat) — reinstala o link, sem custo se já estiver certo ---
bash "$CLIENT_DIR/scripts/link-helena.sh"

# --- reinicia o serviço, se instalado ---
if ! systemctl --user list-unit-files "$SERVICE" >/dev/null 2>&1 || \
   [[ -z "$(systemctl --user list-unit-files "$SERVICE" --no-legend 2>/dev/null)" ]]; then
    warn "$SERVICE não está instalado (rode ./install.sh primeiro) — build atualizado, mas nada foi reiniciado."
    exit 0
fi

bold "Reiniciando $SERVICE..."
systemctl --user restart "$SERVICE"

# --- health check pós-restart ---
PORT="$(read_env "$ENV_FILE" CLIENT_PANEL_PORT)"
PORT="${PORT:-4100}"
for _ in $(seq 1 10); do
    if curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1; then
        ok "Client no ar em http://localhost:$PORT (commit $(git rev-parse --short HEAD))."
        exit 0
    fi
    sleep 1
done
err "Serviço reiniciou mas não respondeu em /health depois de 10s."
info "Cheque: journalctl --user -u $SERVICE -e"
info "Pra voltar ao commit anterior: git reset --hard $BEFORE_SHA && ./update.sh"
exit 1
