#!/usr/bin/env bash
# Stage CUDA toolkit runtime libraries for llama-server inside a CUDA devel container.
# No Node.js required — only bash, ldd, cp, patchelf, and sha256sum.
set -euo pipefail

SERVER_PATH="${1:-}"
if [[ -z "${SERVER_PATH}" || ! -f "${SERVER_PATH}" ]]; then
  echo '[stage-linux-cuda-runtime-libs] Usage: bash scripts/ci/stage-linux-cuda-runtime-libs.sh <path/to/llama-server>' >&2
  exit 1
fi

BIN_DIR="$(cd "$(dirname "${SERVER_PATH}")" && pwd)"
SERVER_PATH="${BIN_DIR}/$(basename "${SERVER_PATH}")"
SEARCH_DIRS=('/usr/local/cuda/lib64' '/usr/local/cuda/lib')
TMP_LIBS="$(mktemp)"
trap 'rm -f "${TMP_LIBS}"' EXIT

is_driver_lib() {
  [[ "$1" =~ ^libcuda\.so ]]
}

resolve_source() {
  local resolved="$1"
  if [[ -f "${resolved}" ]]; then
    readlink -f "${resolved}"
    return 0
  fi
  local base
  base="$(basename "${resolved}")"
  local dir
  for dir in "${SEARCH_DIRS[@]}"; do
    if [[ -f "${dir}/${base}" ]]; then
      readlink -f "${dir}/${base}"
      return 0
    fi
  done
  echo "[stage-linux-cuda-runtime-libs] Could not resolve shared library path: ${resolved}" >&2
  exit 1
}

sha256_file() {
  sha256sum "$1" | awk '{print $1}'
}

while IFS= read -r line; do
  if [[ "${line}" =~ ^[[:space:]]*([^[:space:]]+)[[:space:]]+\=\>[[:space:]]+([^[:space:]]+)[[:space:]]+\( ]]; then
    soname="${BASH_REMATCH[1]}"
    resolved="${BASH_REMATCH[2]}"
    if [[ "${resolved}" == 'not' || "${resolved}" == 'found' ]]; then
      continue
    fi
    if is_driver_lib "${soname}"; then
      continue
    fi
    source_path="$(resolve_source "${resolved}")"
    if is_driver_lib "$(basename "${source_path}")"; then
      echo "[stage-linux-cuda-runtime-libs] Refusing to bundle NVIDIA driver library ${soname}" >&2
      exit 1
    fi
    cp -f "${source_path}" "${BIN_DIR}/${soname}"
    chmod 755 "${BIN_DIR}/${soname}"
    digest="$(sha256_file "${BIN_DIR}/${soname}")"
    printf '%s\t%s\n' "${soname}" "${digest}" >> "${TMP_LIBS}"
  fi
done < <(ldd "${SERVER_PATH}")

if ! patchelf --set-rpath '$ORIGIN' "${SERVER_PATH}"; then
  echo "[stage-linux-cuda-runtime-libs] patchelf failed to set RUNPATH on ${SERVER_PATH}" >&2
  exit 1
fi

MISSING=()
while IFS= read -r line; do
  if [[ "${line}" =~ ^[[:space:]]*([^[:space:]]+)[[:space:]]+\=\>[[:space:]]+not[[:space:]]+found ]]; then
    soname="${BASH_REMATCH[1]}"
    if is_driver_lib "${soname}"; then
      continue
    fi
    MISSING+=("${soname}")
  fi
done < <(ldd "${SERVER_PATH}")

if [[ "${#MISSING[@]}" -gt 0 ]]; then
  echo "[stage-linux-cuda-runtime-libs] llama-server has unresolved dependencies besides libcuda: ${MISSING[*]}" >&2
  exit 1
fi

sort -o "${TMP_LIBS}" "${TMP_LIBS}"
DIGEST="$(while IFS=$'\t' read -r soname digest; do
  printf '%s\0%s\0' "${soname}" "${digest}"
done < "${TMP_LIBS}" | sha256sum | awk '{print $1}')"

STAGED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
INFO_PATH="${BIN_DIR}/runtime-build-info.json"
{
  printf '{\n  "schemaVersion": 1,\n'
  printf '  "source": "nvidia-cuda-toolkit",\n'
  printf '  "toolkitRoot": "/usr/local/cuda",\n'
  printf '  "libraries": [\n'
  first=1
  while IFS=$'\t' read -r soname digest; do
    if [[ "${first}" -eq 1 ]]; then
      first=0
    else
      printf ',\n'
    fi
    printf '    {"soname": "%s", "sha256": "%s"}' "${soname}" "${digest}"
  done < "${TMP_LIBS}"
  printf '\n  ],\n'
  printf '  "librariesDigest": "%s",\n' "${DIGEST}"
  printf '  "stagedAt": "%s"\n' "${STAGED_AT}"
  printf '}\n'
} > "${INFO_PATH}"

LIB_COUNT="$(wc -l < "${TMP_LIBS}" | tr -d ' ')"
echo "[stage-linux-cuda-runtime-libs] Staged ${LIB_COUNT} libraries (${DIGEST:0:12}…)."
