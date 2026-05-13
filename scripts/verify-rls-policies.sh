#!/usr/bin/env bash
# verify-rls-policies.sh
# B3 — CI gate: bloquear deploy si RLS policies count está bajo umbral mínimo.
#
# Razón: migrations 0001 etc. enable RLS deny-all sobre tablas. Sin policies,
# clientes authed reciben 0 rows. Slice 3 escribe policies reales. Antes de
# producir merge a main que activa deploy, validar al menos N policies existen.
#
# Uso CI:
#   bash scripts/verify-rls-policies.sh
#
# Uso local (vs migrations file system):
#   bash scripts/verify-rls-policies.sh
#
# Exit codes:
#   0 = OK (>= MIN_POLICIES policies encontradas)
#   1 = FAIL (under threshold)
#   2 = config / dep missing
#
# Mínimo policies post-Slice 3: ajustar `MIN_POLICIES` cuando policies completas
# se escriban. Pre-Slice 3 = 0 (skip check). Set vía env `MIN_RLS_POLICIES`.

set -euo pipefail

MIN_POLICIES="${MIN_RLS_POLICIES:-0}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "ERROR: migrations dir not found at $MIGRATIONS_DIR" >&2
  exit 2
fi

# Count CREATE POLICY statements across all migration files.
# grep return 1 si no matches → wrap en { ... || true; } para evitar fail bajo pipefail.
policies_count=$({ grep -rE -i "^[[:space:]]*create[[:space:]]+policy" "$MIGRATIONS_DIR" --include="*.sql" 2>/dev/null || true; } | wc -l)
# Strip any whitespace + non-digits (Windows wc -l + bash compat).
policies_count=$(printf "%s" "$policies_count" | tr -cd '0-9')
policies_count="${policies_count:-0}"

echo "RLS policies found in migrations: $policies_count"
echo "Minimum required: $MIN_POLICIES"

if [ "$policies_count" -lt "$MIN_POLICIES" ]; then
  echo "FAIL: RLS policies count below threshold." >&2
  echo "Per AGENTS.md §3 + docs/security-threat-model.md, RLS policies obligatorias" >&2
  echo "antes de prod deploy. Slice 3 escribe policies completas." >&2
  exit 1
fi

# Additional check: every table with `enable row level security` should have
# at least 1 policy (warning, no fail pre-Slice 3).
rls_enabled=$({ grep -rE -i "enable[[:space:]]+row[[:space:]]+level[[:space:]]+security" "$MIGRATIONS_DIR" --include="*.sql" 2>/dev/null || true; } | wc -l)
rls_enabled=$(printf "%s" "$rls_enabled" | tr -cd '0-9')
rls_enabled="${rls_enabled:-0}"

echo "Tables with RLS enabled: $rls_enabled"

if [ "$policies_count" -eq 0 ] && [ "$rls_enabled" -gt 0 ]; then
  echo "WARN: $rls_enabled tables have RLS enabled but 0 policies defined." >&2
  echo "Pre-Slice 3 estado esperado. Post-Slice 3: este gate debe fallar." >&2
fi

echo "PASS: RLS policy verification ok."
exit 0
