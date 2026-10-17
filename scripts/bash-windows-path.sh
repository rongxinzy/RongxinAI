#!/usr/bin/env bash
# shellcheck disable=SC2120
# Convert a path for Node.js on Git Bash / MSYS (Node expects Windows paths, not /d/...).

to_windows_node_path() {
  local input_path="${1:-}"
  if [[ -z "${input_path}" ]]; then
    echo "[bash-windows-path] Missing path argument" >&2
    return 1
  fi
  if [[ "${OS:-}" == "Windows_NT" ]] || [[ -n "${MSYSTEM:-}" ]]; then
    if command -v cygpath >/dev/null 2>&1; then
      cygpath -m "${input_path}"
      return 0
    fi
    if command -v pwd >/dev/null 2>&1; then
      local dir base win_dir
      dir="$(cd "$(dirname "${input_path}")" && pwd -W 2>/dev/null)" || dir=""
      base="$(basename "${input_path}")"
      if [[ -n "${dir}" ]]; then
        printf '%s/%s' "${dir//\\//}" "${base}"
        return 0
      fi
    fi
  fi
  printf '%s' "${input_path}"
}
