#!/usr/bin/env bash
set -euo pipefail

TARGET_ID="${1:-}"
if [[ -z "${TARGET_ID}" ]]; then
  echo "[build-llamacpp-runtime] Missing target id (example: mac-arm64, win-x64, linux-x64)." >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${LLAMACPP_SRC:-/Users/whz/Desktop/rongx/llama.cpp}"
RUNTIME_DIR="${ROOT_DIR}/vendor/llamacpp-runtime/${TARGET_ID}"
BUILD_DIR="${SRC_DIR}/build-rongxinai-${TARGET_ID}"

if [[ ! -d "${SRC_DIR}" ]]; then
  echo "[build-llamacpp-runtime] llama.cpp source not found: ${SRC_DIR}" >&2
  exit 1
fi

find_cmake() {
  if [[ -n "${CMAKE_BIN:-}" && -x "${CMAKE_BIN}" ]]; then
    echo "${CMAKE_BIN}"
    return 0
  fi

  if command -v cmake >/dev/null 2>&1; then
    command -v cmake
    return 0
  fi

  for candidate in \
    /opt/homebrew/bin/cmake \
    /usr/local/bin/cmake \
    /Applications/CMake.app/Contents/bin/cmake
  do
    if [[ -x "${candidate}" ]]; then
      echo "${candidate}"
      return 0
    fi
  done

  return 1
}

CMAKE_BIN_RESOLVED="$(find_cmake || true)"
if [[ -z "${CMAKE_BIN_RESOLVED}" ]]; then
  echo "[build-llamacpp-runtime] cmake is required to build llama-server but was not found." >&2
  echo "[build-llamacpp-runtime] Install it first, for example on macOS: brew install cmake" >&2
  echo "[build-llamacpp-runtime] If cmake is already installed, set CMAKE_BIN=/absolute/path/to/cmake and retry." >&2
  exit 127
fi

"${CMAKE_BIN_RESOLVED}" -S "${SRC_DIR}" -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=ON

"${CMAKE_BIN_RESOLVED}" --build "${BUILD_DIR}" --config Release --target llama-server --parallel

rm -rf "${RUNTIME_DIR}"
mkdir -p "${RUNTIME_DIR}/bin"

SERVER_BIN="${BUILD_DIR}/bin/llama-server"
if [[ "${TARGET_ID}" == win-* ]]; then
  SERVER_BIN="${BUILD_DIR}/bin/Release/llama-server.exe"
  if [[ ! -f "${SERVER_BIN}" ]]; then
    SERVER_BIN="${BUILD_DIR}/bin/llama-server.exe"
  fi
fi

if [[ ! -f "${SERVER_BIN}" ]]; then
  echo "[build-llamacpp-runtime] llama-server binary not found under ${BUILD_DIR}/bin" >&2
  exit 1
fi

cp "${SERVER_BIN}" "${RUNTIME_DIR}/bin/"

if [[ "${TARGET_ID}" == win-* ]]; then
  find "${BUILD_DIR}/bin" -maxdepth 1 -type f \( -name "*.dll" -o -name "*.pdb" \) -exec cp {} "${RUNTIME_DIR}/bin/" \;
else
  find "${BUILD_DIR}/bin" -maxdepth 1 -type f \( -name "*.dylib" -o -name "*.so" \) -exec cp {} "${RUNTIME_DIR}/bin/" \;
fi

cat > "${RUNTIME_DIR}/runtime-build-info.json" <<EOF
{
  "target": "${TARGET_ID}",
  "source": "${SRC_DIR}",
  "builtAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

echo "[build-llamacpp-runtime] Built llama.cpp runtime: ${RUNTIME_DIR}"
