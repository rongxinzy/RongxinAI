#!/usr/bin/env bash
# Run a command up to N times with exponential backoff (transient network blips).
set -euo pipefail

attempts="${ZHIYUAN_DOWNLOAD_RETRY_ATTEMPTS:-4}"
delay_seconds="${ZHIYUAN_DOWNLOAD_RETRY_INITIAL_DELAY_SECONDS:-5}"

if [[ $# -lt 1 ]]; then
  echo 'usage: with-download-retries.sh <command...>' >&2
  exit 2
fi

try=1
while true; do
  if "$@"; then
    exit 0
  fi
  status=$?
  if [[ "$try" -ge "$attempts" ]]; then
    echo "Command failed after ${attempts} attempt(s): $*" >&2
    exit "$status"
  fi
  echo "Attempt ${try}/${attempts} failed (exit ${status}); retrying in ${delay_seconds}s: $*" >&2
  sleep "$delay_seconds"
  try=$((try + 1))
  delay_seconds=$((delay_seconds * 2))
done
