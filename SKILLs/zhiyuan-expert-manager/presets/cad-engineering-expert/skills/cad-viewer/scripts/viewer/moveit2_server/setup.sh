#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=conda-common.sh
source "${SCRIPT_DIR}/conda-common.sh"

REPO_ROOT="$(find_repo_root)"
CONDA="$(find_conda)"
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_cyclonedds_cpp}"
export PYTHONPATH="${SCRIPT_DIR}${PYTHONPATH:+:${PYTHONPATH}}"

"${CONDA}" env update --file "${SCRIPT_DIR}/environment.yml" --prune
"${CONDA}" run --no-capture-output -n "${MOVEIT2_SERVER_CONDA_ENV_NAME}" python -m pip install -e "${SCRIPT_DIR}"
"${CONDA}" run --no-capture-output -n "${MOVEIT2_SERVER_CONDA_ENV_NAME}" python -m moveit2_server.server --check --repo-root "${REPO_ROOT}"
