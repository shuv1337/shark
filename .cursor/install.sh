#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the SHark monorepo.
set -euo pipefail

cd "$(dirname "$0")/.."

# Install a `node` shim so tooling resolves Node >= 22.16 (needed by the
# better-auth node:sqlite tests) instead of the exec-daemon's bundled 22.14.
# See .cursor/ensure-node-shim.sh for the full rationale. Bakes into the build
# snapshot here; the `start` step reasserts it per boot.
bash .cursor/ensure-node-shim.sh || true

# Use the selected Node for the rest of this script (pnpm install etc.).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
NODE_BIN="$(nvm which default 2>/dev/null || true)"
[ -n "$NODE_BIN" ] && export PATH="$(dirname "$NODE_BIN"):$PATH"

corepack enable >/dev/null 2>&1 || true

echo "Using Node $(node -v) / pnpm $(pnpm -v)"

# --- Dependencies ---------------------------------------------------------
pnpm install --frozen-lockfile

# --- Dev env file ---------------------------------------------------------
# apps/website loads ../../.env via `node --env-file`, which fails when the file
# is missing, so ensure one exists. It is intentionally minimal: unset
# credentials fall back to schema defaults and the server only warns (not fails)
# for missing push/auth secrets in development. Real secrets belong in Cloud
# Agent Secrets, never committed (.env is gitignored).
if [ ! -f .env ]; then
  cat >.env <<'ENV'
NODE_ENV=development
# The Vite dev server (port 8787, proxies /api and /hooks) is the browser origin.
APP_URL=http://localhost:8787
# Dev SQLite file, relative to apps/website.
DATABASE_URL=./data/hark.sqlite
# API port. `pnpm dev` runs the API on 8788 and Vite on 8787 (proxying to 8788).
PORT=8788
ENV
  echo "Created development .env"
fi
