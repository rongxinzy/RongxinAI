#!/usr/bin/env bash
set -euo pipefail

# RTX 40-series (Ada) only: sm_89, CUDA 12.4 toolchain for broad driver support.
PLATFORM="${1:-linux}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${LLAMACPP_SRC:-${ROOT_DIR}/.cache/llama.cpp-src}"
BUILD_DIR="${SRC_DIR}/build-zhiyuan-cuda-rtx40-${PLATFORM}"
EDITION_ROOT="${ROOT_DIR}/vendor/llamacpp/cuda"

if [[ ! -f "${SRC_DIR}/CMakeLists.txt" ]]; then
  bash "${ROOT_DIR}/scripts/ensure-llamacpp-cuda-source.sh"
fi

if [[ "${PLATFORM}" == 'win' || "${PLATFORM}" == 'windows' ]]; then
  unset CMAKE_GENERATOR CMAKE_GENERATOR_PLATFORM || true
  rm -rf "${BUILD_DIR}"
fi

CMAKE_ARGS=(
  -S "${SRC_DIR}"
  -B "${BUILD_DIR}"
  -DCMAKE_BUILD_TYPE=Release
  -DLLAMA_BUILD_UI=OFF
  -DLLAMA_BUILD_TESTS=OFF
  -DLLAMA_BUILD_EXAMPLES=OFF
  -DLLAMA_BUILD_SERVER=ON
  -DGGML_CUDA=ON
  -DCMAKE_CUDA_ARCHITECTURES=89
  -DCUDA_VERSION=12.4
)

case "${PLATFORM}" in
  linux)
    # Match ggml-org/llama.cpp .devops/cuda.Dockerfile: devel images have no driver libcuda.so.
    CMAKE_ARGS+=(
      -G Ninja
      -DGGML_METAL=OFF
      -DCMAKE_EXE_LINKER_FLAGS=-Wl,--allow-shlib-undefined
      -DCMAKE_BUILD_RPATH='$ORIGIN'
      -DCMAKE_INSTALL_RPATH='$ORIGIN'
    )
    EXECUTABLE_NAME=llama-server
    BUILD_CONFIG=()
    ;;
  win|windows)
    # Match ggml-org/llama.cpp release.yml windows-cuda: Ninja + MSVC toolset (not VS CUDA integration).
    CMAKE_ARGS+=(
      -G Ninja
      -DCMAKE_BUILD_TYPE=Release
      -DGGML_METAL=OFF
    )
    EXECUTABLE_NAME=llama-server.exe
    BUILD_CONFIG=(--config Release)
    ;;
  *)
    echo "Unsupported platform: ${PLATFORM}" >&2
    exit 1
    ;;
esac

echo "[build-llamacpp-cuda-rtx40] Running: cmake ${CMAKE_ARGS[*]}"
cmake "${CMAKE_ARGS[@]}"
cmake --build "${BUILD_DIR}" "${BUILD_CONFIG[@]}" --target llama-server -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

BUILT_SERVER="$(
  find "${BUILD_DIR}" -type f -name "${EXECUTABLE_NAME}" 2>/dev/null | head -n 1
)"
if [[ -z "${BUILT_SERVER}" || ! -f "${BUILT_SERVER}" ]]; then
  echo "[build-llamacpp-cuda-rtx40] Could not locate ${EXECUTABLE_NAME} under ${BUILD_DIR}" >&2
  exit 1
fi

BIN_DIR="${EDITION_ROOT}/bin"
mkdir -p "${BIN_DIR}"
if [[ "${PLATFORM}" == 'win' || "${PLATFORM}" == 'windows' ]]; then
  # BUILD_SHARED_LIBS is on: llama-server.exe imports the llama/ggml DLLs built
  # alongside it (including the sm_89 ggml-cuda.dll). Ship exactly those; never
  # mix in DLLs from an official release build (different ABI and CUDA archs).
  rm -rf "${BIN_DIR}"
  mkdir -p "${BIN_DIR}"
  cp "$(dirname "${BUILT_SERVER}")"/*.dll "${BIN_DIR}/"
fi
cp "${BUILT_SERVER}" "${BIN_DIR}/${EXECUTABLE_NAME}"
chmod +x "${BIN_DIR}/${EXECUTABLE_NAME}" 2>/dev/null || true

echo "[build-llamacpp-cuda-rtx40] Built ${BIN_DIR}/${EXECUTABLE_NAME} (sm_89, CUDA 12.4)."
echo "[build-llamacpp-cuda-rtx40] Run scripts/finalize-llamacpp-cuda-edition.cjs to bundle CUDA libs and CPU fallback."
