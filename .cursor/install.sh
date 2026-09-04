#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the SHark monorepo.
set -euo pipefail

cd "$(dirname "$0")/.."

# Select a Node >= 22.16: the app runs on any Node 22, but the better-auth
# integration tests use node:sqlite's StatementSync.columns(), added in 22.16.
# The default Cloud image ships that Node via nvm, while the exec-daemon's
# bundled Node (22.14) otherwise shadows it on PATH. Match CI (node-version: 22).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use default >/dev/null 2>&1 || true
fi

corepack enable >/dev/null 2>&1 || true

echo "Using Node $(node -v) / pnpm $(pnpm -v)"

pnpm install --frozen-lockfile

# Dev-only env file for apps/website (loaded via `node --env-file=../../.env`).
# node --env-file fails when the file is missing, so ensure one exists. It is
# intentionally minimal: unset credentials fall back to schema defaults and the
# server only warns (not fails) for missing push/auth secrets in development.
# Real secrets belong in Cloud Agent Secrets, never committed (.env is gitignored).
if [ ! -f .env ]; then
  cat > .env <<'ENV'
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
