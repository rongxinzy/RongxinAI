#!/usr/bin/env bash

MOVEIT2_SERVER_CONDA_ENV_NAME="${MOVEIT2_SERVER_CONDA_ENV_NAME:-moveit2-server}"

find_conda() {
  if [[ -n "${MOVEIT2_SERVER_CONDA_EXE:-}" && -x "${MOVEIT2_SERVER_CONDA_EXE}" ]]; then
    printf '%s\n' "${MOVEIT2_SERVER_CONDA_EXE}"
    return 0
  fi
  if [[ -n "${CONDA_EXE:-}" && -x "${CONDA_EXE}" ]]; then
    printf '%s\n' "${CONDA_EXE}"
    return 0
  fi
  if command -v conda >/dev/null 2>&1; then
    command -v conda
    return 0
  fi
  local candidate
  for candidate in \
    "${HOME}/miniforge3/bin/conda" \
    "${HOME}/mambaforge/bin/conda" \
    "${HOME}/miniconda3/bin/conda" \
    "${HOME}/anaconda3/bin/conda" \
    "/opt/conda/bin/conda"
  do
    if [[ -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  printf 'Could not find conda. Install Miniforge, put conda on PATH, or set MOVEIT2_SERVER_CONDA_EXE/CONDA_EXE.\n' >&2
  return 1
}

find_repo_root() {
  if [[ -n "${MOVEIT2_SERVER_REPO_ROOT:-}" ]]; then
    if [[ ! -d "${MOVEIT2_SERVER_REPO_ROOT}" ]]; then
      printf 'MOVEIT2_SERVER_REPO_ROOT does not exist: %s\n' "${MOVEIT2_SERVER_REPO_ROOT}" >&2
      return 1
    fi
    (cd "${MOVEIT2_SERVER_REPO_ROOT}" && pwd -P)
    return 0
  fi

  local root
  if root="$(git -C "${PWD}" rev-parse --show-toplevel 2>/dev/null)"; then
    printf '%s\n' "${root}"
    return 0
  fi

  printf 'Could not find a repository root from the current directory. Run from the robot project repo or set MOVEIT2_SERVER_REPO_ROOT.\n' >&2
  return 1
}
