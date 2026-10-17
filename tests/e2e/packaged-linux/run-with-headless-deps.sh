#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec dbus-run-session -- bash -c "
  mkdir -p \"\${HOME}/.local/share/keyrings\"
  eval \$(echo -n 'zhiyuan-e2e' | gnome-keyring-daemon --unlock 2>/dev/null || true)
  gnome-keyring-daemon --start --components=secrets >/dev/null 2>&1 || true
  exec xvfb-run -a node \"${SCRIPT_DIR}/run-packaged-smoke.mjs\" \"\$@\"
" -- "$@"
