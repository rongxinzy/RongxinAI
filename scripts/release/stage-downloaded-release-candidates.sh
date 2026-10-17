#!/usr/bin/env bash
# Reorganize pattern-downloaded release candidate artifacts into candidate/<bundle-id>/.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo 'usage: stage-downloaded-release-candidates.sh <release-version> [staging-dir] [dest-dir]' >&2
  exit 1
fi

version="$1"
staging="${2:-candidate-staging}"
dest="${3:-candidate}"

prefix="release-candidate-${version}-"
shopt -s nullglob

found=0
for artifact_dir in "${staging}/${prefix}"*; do
  [[ -d "$artifact_dir" ]] || continue
  found=1
  bundle="$(basename "$artifact_dir")"
  bundle="${bundle#"${prefix}"}"
  if [[ -z "$bundle" || "$bundle" == *'/'* || "$bundle" == *'..'* ]]; then
    echo "Unexpected release candidate artifact directory: ${artifact_dir}" >&2
    exit 1
  fi
  mkdir -p "${dest}/${bundle}"
  shopt -s dotglob
  mv "${artifact_dir}/"* "${dest}/${bundle}/"
  shopt -u dotglob
  rmdir "$artifact_dir"
done

if [[ "$found" -eq 0 ]]; then
  echo "No release candidate artifacts matched ${prefix}* under ${staging}" >&2
  ls -la "${staging}" >&2 || true
  exit 1
fi

rmdir "${staging}" 2>/dev/null || true
