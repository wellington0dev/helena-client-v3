#!/usr/bin/env bash
# Para o serviço systemd --user do client/ instalado por ./install.sh, sem
# desabilitá-lo (volta a subir sozinho no próximo boot, já que o serviço
# continua "enabled" — pra reiniciar já rodando, use ./update.sh ou
# `systemctl --user start helena-client.service`). Idempotente — já
# parado (ou nunca instalado) não é erro. Mesma lógica de backend-v2/stop.sh.
#
# Uso: ./stop.sh

set -euo pipefail

SERVICE="helena-client.service"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$1"; }
err()  { printf '\033[31m  x %s\033[0m\n' "$1" >&2; }
ok()   { printf '\033[32m  v %s\033[0m\n' "$1"; }

if ! systemctl --user list-unit-files "$SERVICE" >/dev/null 2>&1 || \
   [[ -z "$(systemctl --user list-unit-files "$SERVICE" --no-legend 2>/dev/null)" ]]; then
    warn "$SERVICE não está instalado (rode ./install.sh primeiro) — nada a parar."
    exit 0
fi

if ! systemctl --user is-active --quiet "$SERVICE"; then
    ok "$SERVICE já estava parado."
    exit 0
fi

bold "Parando $SERVICE..."
systemctl --user stop "$SERVICE"
ok "$SERVICE parado."
