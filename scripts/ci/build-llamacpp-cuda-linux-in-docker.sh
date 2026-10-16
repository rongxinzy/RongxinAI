#!/usr/bin/env bash
set -euo pipefail

# Build the Linux CUDA llama-server on Ubuntu 22.04 + CUDA 12.4 inside Docker.
# GitHub ubuntu-latest (24.04) cannot install CUDA 12.4 via apt; the resulting
# binary targets glibc from 22.04 and remains compatible with newer distros.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${LLAMACPP_CUDA_DOCKER_IMAGE:-nvidia/cuda:12.4.1-devel-ubuntu22.04}"

if ! command -v docker >/dev/null 2>&1; then
  echo '[build-llamacpp-cuda-linux-in-docker] docker is not available' >&2
  exit 1
fi

bash "${ROOT_DIR}/scripts/ensure-llamacpp-cuda-source.sh"

echo "[build-llamacpp-cuda-linux-in-docker] Pulling ${IMAGE}"
docker pull "${IMAGE}"

echo '[build-llamacpp-cuda-linux-in-docker] Compiling llama-server (sm_89, CUDA 12.4)'
docker run --rm \
  -v "${ROOT_DIR}:/workspace" \
  -w /workspace \
  -e LLAMACPP_SRC=/workspace/.cache/llama.cpp-src \
  "${IMAGE}" \
  bash -lc '
    set -euo pipefail
    git config --global --add safe.directory "*"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y --no-install-recommends cmake ninja-build git ca-certificates
    rm -rf /var/lib/apt/lists/*
    nvcc --version
    bash scripts/build-llamacpp-cuda-rtx40.sh linux
  '

server="${ROOT_DIR}/vendor/llamacpp/cuda/bin/llama-server"
if [[ ! -x "${server}" ]]; then
  echo "[build-llamacpp-cuda-linux-in-docker] Missing built server at ${server}" >&2
  exit 1
fi

echo "[build-llamacpp-cuda-linux-in-docker] Built ${server}"
