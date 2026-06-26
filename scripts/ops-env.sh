#!/usr/bin/env bash
# Charge les secrets ops depuis .env.secrets.local (gitignoré).
# Usage :  source scripts/ops-env.sh   puis lance tes scripts (python, curl…).
# Les variables sont exportées dans l'environnement courant.

_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
_file="$_dir/.env.secrets.local"

if [ ! -f "$_file" ]; then
  echo "⚠️  $_file introuvable. Crée-le (voir scripts/ops-env.sh)." >&2
  return 1 2>/dev/null || exit 1
fi

set -a
# shellcheck disable=SC1090
. "$_file"
set +a

# Compat : certains scripts attendent SB_TOKEN / N8N_KEY
export SB_TOKEN="${SB_TOKEN:-$SUPABASE_SBP_TOKEN}"
export N8N_KEY="${N8N_KEY:-$N8N_API_KEY}"

_missing=()
[ -z "$SUPABASE_SERVICE_ROLE_KEY" ] && _missing+=("SUPABASE_SERVICE_ROLE_KEY")
[ -z "$N8N_API_KEY" ] && _missing+=("N8N_API_KEY")
if [ "${#_missing[@]}" -gt 0 ]; then
  echo "ℹ️  Secrets chargés. Manquent encore : ${_missing[*]} (à compléter dans .env.secrets.local)" >&2
else
  echo "✅ Tous les secrets ops sont chargés." >&2
fi
