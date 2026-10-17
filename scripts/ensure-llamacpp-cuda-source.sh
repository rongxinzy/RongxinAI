#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/bash-windows-path.sh
source "${ROOT_DIR}/scripts/bash-windows-path.sh"
PACKAGE_JSON_FOR_NODE="$(to_windows_node_path "${ROOT_DIR}/package.json")"
SRC_DIR="${LLAMACPP_SRC:-${ROOT_DIR}/.cache/llama.cpp-src}"
RELEASE_TAG="$(
  node -p "JSON.parse(require('fs').readFileSync('${PACKAGE_JSON_FOR_NODE}','utf8')).llamacpp?.runtimeReleaseTag || 'b9244'"
)"

if [[ -f "${SRC_DIR}/CMakeLists.txt" ]]; then
  echo "[ensure-llamacpp-cuda-source] Using existing source at ${SRC_DIR}"
  exit 0
fi

mkdir -p "$(dirname "${SRC_DIR}")"
echo "[ensure-llamacpp-cuda-source] Cloning ggml-org/llama.cpp tag ${RELEASE_TAG} into ${SRC_DIR}"
git clone --depth 1 --branch "${RELEASE_TAG}" https://github.com/ggml-org/llama.cpp.git "${SRC_DIR}"

if [[ ! -f "${SRC_DIR}/CMakeLists.txt" ]]; then
  echo "[ensure-llamacpp-cuda-source] Clone did not produce a CMake project." >&2
  exit 1
fi
