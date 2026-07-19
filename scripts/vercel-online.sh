#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERCEL_CMD=(npx vercel)
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  VERCEL_CMD+=(--token "$VERCEL_TOKEN")
fi

run_vercel() {
  "${VERCEL_CMD[@]}" "$@"
}

if [[ ! -f ".env" ]]; then
  echo "Missing .env in project root."
  exit 1
fi

if ! run_vercel whoami >/dev/null 2>&1; then
  echo "Vercel is not logged in. Run: npx vercel login"
  exit 1
fi

env_lines=()
while IFS= read -r line; do
  env_lines+=("$line")
done < <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env || true)

if [[ ${#env_lines[@]} -eq 0 ]]; then
  echo "No env variables found in .env"
  exit 1
fi

required_vars=("DEEPSEEK_API_KEY" "DEEPSEEK_BASE_URL" "DEEPSEEK_MODEL")
for key in "${required_vars[@]}"; do
  if ! grep -q "^${key}=" .env; then
    echo "Missing required key in .env: ${key}"
    exit 1
  fi
done

sync_env_value() {
  local key="$1"
  local value="$2"
  local target="$3"

  run_vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
  run_vercel env add "$key" "$target" --value "$value" --yes >/dev/null
}

targets_raw="${VERCEL_ENV_TARGETS:-production}"
targets=()
IFS=',' read -r -a targets <<< "$targets_raw"
for target in "${targets[@]}"; do
  echo "Syncing .env -> Vercel (${target})"
  for line in "${env_lines[@]}"; do
    key="${line%%=*}"
    value="${line#*=}"
    sync_env_value "$key" "$value" "$target"
  done
done

echo "Deploying production..."
run_vercel deploy --prod --yes

echo "Done. DeepSeek env is now connected online."
