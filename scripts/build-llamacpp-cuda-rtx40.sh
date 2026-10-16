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
      -DGGML_METAL=OFF
      -DCMAKE_EXE_LINKER_FLAGS=-Wl,--allow-shlib-undefined
    )
    EXECUTABLE_NAME=llama-server
    ;;
  win|windows)
    CMAKE_ARGS+=(-DGGML_METAL=OFF)
    EXECUTABLE_NAME=llama-server.exe
    ;;
  *)
    echo "Unsupported platform: ${PLATFORM}" >&2
    exit 1
    ;;
esac

cmake "${CMAKE_ARGS[@]}"
cmake --build "${BUILD_DIR}" --config Release --target llama-server -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)"

BUILT_SERVER="$(
  find "${BUILD_DIR}" -type f -name "${EXECUTABLE_NAME}" 2>/dev/null | head -n 1
)"
if [[ -z "${BUILT_SERVER}" || ! -f "${BUILT_SERVER}" ]]; then
  echo "[build-llamacpp-cuda-rtx40] Could not locate ${EXECUTABLE_NAME} under ${BUILD_DIR}" >&2
  exit 1
fi

BIN_DIR="${EDITION_ROOT}/bin"
mkdir -p "${BIN_DIR}"
cp "${BUILT_SERVER}" "${BIN_DIR}/${EXECUTABLE_NAME}"
chmod +x "${BIN_DIR}/${EXECUTABLE_NAME}" 2>/dev/null || true

echo "[build-llamacpp-cuda-rtx40] Built ${BIN_DIR}/${EXECUTABLE_NAME} (sm_89, CUDA 12.4)."
echo "[build-llamacpp-cuda-rtx40] Run scripts/finalize-llamacpp-cuda-edition.cjs to bundle CUDA libs and CPU fallback."
