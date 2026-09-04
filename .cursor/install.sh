#!/usr/bin/env bash
# Idempotent Cloud Agent bootstrap for the SHark monorepo.
set -euo pipefail

cd "$(dirname "$0")/.."

# --- Node selection -------------------------------------------------------
# The app runs on any Node 22 (it uses the native better-sqlite3 module), but
# better-auth's integration tests use node:sqlite's StatementSync.columns(),
# added in Node 22.16. CI runs on `node-version: 22` (latest 22.x), so those
# tests pass there. The Cloud image ships a suitable Node (>=22.22) via nvm,
# but the exec-daemon force-prepends /exec-daemon to PATH on *every* command
# and its bundled Node (22.14) shadows nvm — so `nvm use` and pnpm's
# use-node-version cannot win in the shells the agent and terminals use. The
# fix: drop a `node` shim in the first writable PATH entry that sits ahead of
# /exec-daemon, so every tool (pnpm, vitest, tsx) resolves the newer runtime.
ORIG_PATH="$PATH"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

node_provides_columns() {
  [ -x "$1" ] &&
    "$1" -e 'const s=require("node:sqlite");process.exit(typeof new s.DatabaseSync(":memory:").prepare("select 1").columns==="function"?0:1)' 2>/dev/null
}

NODE_BIN="$(nvm which default 2>/dev/null || true)"
if [ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ]; then
  if ! node_provides_columns "$NODE_BIN"; then
    echo "WARNING: nvm default $("$NODE_BIN" -v) lacks node:sqlite columns(); better-auth tests may fail (need Node >= 22.16)." >&2
  fi
  # Only shim inside the exec-daemon environment, where /exec-daemon shadows nvm.
  case ":$ORIG_PATH:" in
    *:/exec-daemon:* | *:/exec-daemon/*:*)
      shim_dir=""
      IFS=':' read -ra _paths <<<"$ORIG_PATH"
      for d in "${_paths[@]}"; do
        case "$d" in
          /exec-daemon | /exec-daemon/*) break ;;
        esac
        if [ -d "$d" ] && [ -w "$d" ]; then
          shim_dir="$d"
          break
        fi
      done
      if [ -n "$shim_dir" ] && [ "$shim_dir" != "$(dirname "$NODE_BIN")" ]; then
        printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$NODE_BIN" >"$shim_dir/node"
        chmod +x "$shim_dir/node"
        echo "Installed node shim: $shim_dir/node -> $NODE_BIN ($("$NODE_BIN" -v))"
      elif [ -z "$shim_dir" ]; then
        echo "WARNING: no writable PATH dir ahead of /exec-daemon; 'node' may resolve to an older runtime." >&2
      fi
      ;;
  esac
  # Use the selected Node for the rest of this script.
  export PATH="$(dirname "$NODE_BIN"):$PATH"
else
  echo "WARNING: could not resolve an nvm default Node; using PATH node $(command -v node || echo none)." >&2
fi

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
