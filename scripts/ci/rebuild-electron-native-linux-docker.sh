#!/usr/bin/env bash
set -euo pipefail

# Rebuild Electron native modules on Ubuntu 22.04 so linux-x64 .node files target
# that distro's glibc (2.35), not the newer glibc on GitHub ubuntu-latest runners.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${LINUX_NATIVE_BUILD_IMAGE:-ubuntu:22.04}"
NODE_VERSION="$(tr -d '[:space:]' < "${ROOT_DIR}/.nvmrc")"

if ! command -v docker >/dev/null 2>&1; then
  echo '[rebuild-electron-native-linux-docker] docker is not available' >&2
  exit 1
fi

if [[ ! -f "${ROOT_DIR}/node_modules/electron/package.json" ]]; then
  echo '[rebuild-electron-native-linux-docker] node_modules/electron is missing; run bun install first' >&2
  exit 1
fi

HOST_UID="$(id -u)"
HOST_GID="$(id -g)"

echo "[rebuild-electron-native-linux-docker] Pulling ${IMAGE}"
docker pull "${IMAGE}"

echo "[rebuild-electron-native-linux-docker] Rebuilding better-sqlite3 and node-pty for Electron (Node ${NODE_VERSION})"
docker run --rm \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace \
  -e NODE_VERSION="${NODE_VERSION}" \
  -e HOST_UID="${HOST_UID}" \
  -e HOST_GID="${HOST_GID}" \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends \
      ca-certificates curl python3 make g++ git binutils
    rm -rf /var/lib/apt/lists/*

    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
      | tar -xJ -C /usr/local --strip-components=1
    node --version
    npm --version

    cd /workspace
    ./node_modules/.bin/electron-rebuild --only better-sqlite3,node-pty --force --build-from-source

    chown -R "${HOST_UID}:${HOST_GID}" \
      node_modules/better-sqlite3/build \
      node_modules/node-pty/build
  '

for artifact in \
  "${ROOT_DIR}/node_modules/node-pty/build/Release/pty.node" \
  "${ROOT_DIR}/node_modules/node-pty/build/Release/spawn-helper" \
  "${ROOT_DIR}/node_modules/better-sqlite3/build/Release/better_sqlite3.node"; do
  if [[ ! -f "${artifact}" ]]; then
    echo "[rebuild-electron-native-linux-docker] Missing rebuilt artifact: ${artifact}" >&2
    exit 1
  fi
done

echo '[rebuild-electron-native-linux-docker] Rebuild complete'
