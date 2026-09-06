#!/usr/bin/env bash
# Linka o comando global `helena` (chat interativo) no bin global do npm
# (que está no PATH do usuário), sem sudo. Idempotente.
#
# Uso: bash scripts/link-helena.sh

set -euo pipefail

CLIENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$CLIENT_DIR/bin/helena.js"

LINK_DIR="$(npm prefix -g 2>/dev/null)/bin"
if [[ "$LINK_DIR" != "/bin" && ( -w "$LINK_DIR" || ( ! -e "$LINK_DIR" && -w "$(dirname "$LINK_DIR")" ) ) ]]; then
    mkdir -p "$LINK_DIR"
    ln -sf "$TARGET" "$LINK_DIR/helena"
    echo "  comando 'helena' linkado em $LINK_DIR/helena"
    echo ":$PATH:" | grep -q ":$LINK_DIR:" || echo "  ! $LINK_DIR não está no seu PATH — adicione pra usar 'helena' de qualquer lugar."
else
    # Fallback: bin global não gravável (ex: prefix em /usr). Usa ~/.local/bin.
    mkdir -p "$HOME/.local/bin"
    ln -sf "$TARGET" "$HOME/.local/bin/helena"
    echo "  comando 'helena' linkado em ~/.local/bin/helena"
    echo ":$PATH:" | grep -q ":$HOME/.local/bin:" || echo "  ! ~/.local/bin não está no PATH — adicione: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
