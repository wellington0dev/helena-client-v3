#!/usr/bin/env bash
# Helpers compartilhados pra ler/escrever chaves no .env do client/. Cópia
# de backend/scripts/lib-env.sh — client/ é um pacote independente (vive no
# próprio repo, helena-client-v3), não importa scripts de fora dele.
# Sourced por install.sh — não roda sozinho.

# upsert_env <arquivo> <chave> <valor> — cria ou atualiza CHAVE=valor no lugar.
upsert_env() {
    local file="$1" key="$2" value="$3"
    touch "$file"
    if grep -qE "^${key}=" "$file"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
        printf '%s=%s\n' "$key" "$value" >> "$file"
    fi
}

# read_env <arquivo> <chave> — imprime o valor (última ocorrência, sem aspas
# ao redor). Vazio se o arquivo ou a chave não existirem.
read_env() {
    local file="$1" key="$2"
    [[ -f "$file" ]] || return 0
    grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//'
}
