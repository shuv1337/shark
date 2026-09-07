#!/usr/bin/env bash
# Ensure a `node` >= 22.16 wins over the exec-daemon's bundled Node (22.14).
#
# The app runs on any Node 22 (native better-sqlite3), but better-auth's
# integration tests use node:sqlite's StatementSync.columns(), added in Node
# 22.16. CI runs on `node-version: 22` (latest 22.x). The Cloud image ships a
# suitable Node (>=22.22) via nvm, but the exec-daemon force-prepends
# /exec-daemon to PATH on every command and its bundled Node (22.14) shadows
# nvm — `nvm use` and pnpm's use-node-version both lose that race. The fix is a
# `node` shim in a writable PATH dir that sits ahead of /exec-daemon at runtime.
#
# This runs from both `install` (bakes the shim into the build snapshot; at
# build time /exec-daemon is absent, so it targets the known runtime-leading
# dir) and `start` (reasserts per-boot at runtime via dynamic detection). It is
# idempotent and never fails the caller.
set -euo pipefail

# Capture PATH before sourcing nvm, which prepends its own bin dir and would
# otherwise mask the exec-daemon shadowing we are detecting.
ORIG_PATH="$PATH"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

NODE_BIN="$(nvm which default 2>/dev/null || true)"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "ensure-node-shim: no nvm default Node found; skipping." >&2
  exit 0
fi

node_bin_dir="$(dirname "$NODE_BIN")"

pick_shim_dir() {
  # At runtime /exec-daemon is on PATH: use the first writable entry ahead of it.
  case ":$ORIG_PATH:" in
    *:/exec-daemon:* | *:/exec-daemon/*:*)
      IFS=':' read -ra _paths <<<"$ORIG_PATH"
      for d in "${_paths[@]}"; do
        case "$d" in
          /exec-daemon | /exec-daemon/*) break ;;
        esac
        if [ -d "$d" ] && [ -w "$d" ]; then
          printf '%s' "$d"
          return 0
        fi
      done
      ;;
  esac
  # At build time /exec-daemon is absent: target the dir known to lead PATH at
  # runtime (verified: /usr/local/cargo/bin sits ahead of /exec-daemon).
  for d in /usr/local/cargo/bin; do
    if [ -d "$d" ] && [ -w "$d" ]; then
      printf '%s' "$d"
      return 0
    fi
  done
  return 1
}

shim_dir="$(pick_shim_dir || true)"
if [ -z "$shim_dir" ]; then
  echo "ensure-node-shim: no writable PATH dir ahead of /exec-daemon found; skipping." >&2
  exit 0
fi
if [ "$shim_dir" = "$node_bin_dir" ]; then
  echo "ensure-node-shim: selected Node already leads PATH ($shim_dir); no shim needed."
  exit 0
fi

printf '#!/usr/bin/env bash\nexec "%s" "$@"\n' "$NODE_BIN" >"$shim_dir/node"
chmod +x "$shim_dir/node"
echo "ensure-node-shim: $shim_dir/node -> $NODE_BIN ($("$NODE_BIN" -v))"
