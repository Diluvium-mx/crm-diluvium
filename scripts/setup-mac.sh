#!/usr/bin/env bash
# Prepara una Mac para trabajar en el CRM Diluvium (ver docs/migrar-mac.md).
# Instala lo que falte, crea ~/Documents/Diluvium/{crm-diluvium,chats,media,notas},
# clona el repo e instala dependencias. No toca secretos ni inicia sesiones por ti.
# Se puede correr varias veces: lo que ya existe se deja igual.
set -euo pipefail

BASE="$HOME/Documents/Diluvium"
REPO_DIR="$BASE/crm-diluvium"
REPO="Diluvium-mx/crm-diluvium"

paso() { printf '\n==> %s\n' "$1"; }

paso "Xcode Command Line Tools"
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo "Termina la instalación de Xcode Command Line Tools y vuelve a correr este script."
  exit 1
fi

paso "Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  echo "Falta Homebrew. Instálalo desde https://brew.sh y vuelve a correr este script."
  exit 1
fi

paso "Herramientas (node, gh, postgresql@18, ffmpeg, jq)"
for f in node gh postgresql@18 ffmpeg jq; do
  if brew list --formula "$f" >/dev/null 2>&1; then
    echo "  $f ya está"
  else
    brew install "$f"
  fi
done
brew services start postgresql@18 >/dev/null 2>&1 || true

paso "CLIs globales de npm (Railway y Codex)"
for p in @railway/cli @openai/codex; do
  if npm ls -g --depth=0 "$p" >/dev/null 2>&1; then
    echo "  $p ya está"
  else
    npm install -g "$p"
  fi
done

paso "Carpetas"
mkdir -p "$BASE/chats" "$BASE/media" "$BASE/notas"

paso "Repo"
if [ -d "$REPO_DIR/.git" ]; then
  echo "  ya existe $REPO_DIR"
else
  if ! gh auth status >/dev/null 2>&1; then
    echo "Primero inicia sesión en GitHub: gh auth login (ver docs/migrar-mac.md §3)."
    exit 1
  fi
  gh auth setup-git
  gh repo clone "$REPO" "$REPO_DIR"
fi

paso "Dependencias"
cd "$REPO_DIR"
npm ci

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "  Se creó .env.local vacío desde .env.example: llénalo con valores LOCALES."
fi

paso "Listo"
cat <<EOF
Falta hacer a mano (docs/migrar-mac.md §3 a §6):
  1. railway login  y  railway link  (energetic-ambition / production / crm-diluvium)
  2. codex login  y en Claude Code: /plugin install codex@openai-codex  y  /codex:setup
  3. Copiar media/, notas/, la memoria de Claude y ~/.claude/skills/cyber-neo desde la Mac vieja
  4. Llenar .env.local y correr: npm run typecheck && npm test && npm run lint
EOF
