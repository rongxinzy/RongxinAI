#!/usr/bin/env bash
# Publish one platform stage (win32 | darwin | linux) to the beta update channel.
set -euo pipefail

platform="${1:?platform required (win32|darwin|linux)}"
version="${2:?version required}"
commit="${3:?commit sha required}"
pipeline_id="${4:?pipeline run id required}"

export ZHIYUAN_RELEASE_PLATFORM="$platform"
export UPDATE_SOURCE_PIPELINE_ID="$pipeline_id"
export UPDATE_RELEASE_CHANNEL=beta

manifests=()
roots=()
while IFS=$'\t' read -r bundle manifest; do
  manifests+=("candidate/${bundle}/${manifest}")
  roots+=("candidate/${bundle}")
done < <(node scripts/release/print-release-candidate-layout.mjs)

for manifest in "${manifests[@]}"; do
  [[ -f "$manifest" ]] || { echo "Missing release manifest: $manifest" >&2; exit 1; }
done

node scripts/release/verify-release-candidate.mjs \
  "$version" \
  "$commit" \
  "$pipeline_id" \
  "${manifests[@]}" \
  --payload-roots "${roots[@]}"

node scripts/release/upload-release-candidate.mjs \
  "$version" \
  "$commit" \
  "$pipeline_id" \
  uploaded-metadata \
  "${manifests[@]}" \
  --payload-roots "${roots[@]}"

shopt -s nullglob
for file in uploaded-metadata/update-artifacts-*.json; do
  aws s3api put-object \
    --bucket "$R2_BUCKET" \
    --key "generations/${version}/build-metadata/$(basename "$file")" \
    --body "$file" \
    --content-type application/json \
    --cache-control 'public, max-age=31536000, immutable'
done

metadata=(uploaded-metadata/update-artifacts-*.json)
[[ ${#metadata[@]} -gt 0 ]] || { echo 'Missing uploaded artifact metadata' >&2; exit 1; }

node scripts/release/publish-update-manifest.mjs \
  manifest/beta-partial.json \
  "$version" \
  "$commit" \
  --metadata "${metadata[@]}"

generation_key="generations/${version}/legacy/beta.json"
mkdir -p manifest
set +e
aws s3api head-object --bucket "$R2_BUCKET" --key "$generation_key" > manifest/generation-head.json 2> manifest/generation-head.err
generation_status=$?
set -e
if [[ $generation_status -eq 0 ]]; then
  aws s3api get-object --bucket "$R2_BUCKET" --key "$generation_key" manifest/existing-generation.json > /dev/null
  node scripts/release/merge-update-manifest-collection.mjs \
    manifest/existing-generation.json \
    manifest/beta-partial.json \
    manifest/beta.json
  generation_etag="$(jq -r '.ETag' manifest/generation-head.json)"
  aws s3api put-object \
    --bucket "$R2_BUCKET" \
    --key "$generation_key" \
    --body manifest/beta.json \
    --content-type application/json \
    --cache-control 'public, max-age=31536000, immutable' \
    --if-match "$generation_etag" > /dev/null
else
  if grep -Eq '404|Not Found|NoSuchKey' manifest/generation-head.err; then
    cp manifest/beta-partial.json manifest/beta.json
    aws s3api put-object \
      --bucket "$R2_BUCKET" \
      --key "$generation_key" \
      --body manifest/beta.json \
      --content-type application/json \
      --cache-control 'public, max-age=31536000, immutable' \
      --if-none-match '*' > /dev/null
  else
    cat manifest/generation-head.err >&2
    exit "$generation_status"
  fi
fi

node scripts/release/create-update-generation-pointer.mjs manifest/beta-pointer.json "$version"

set +e
aws s3api head-object --bucket "$R2_BUCKET" --key channels/beta-pointer.json > manifest/current-pointer-head.json 2> manifest/current-pointer-head.err
pointer_status=$?
set -e
pointer_exists=false
legacy_exists=false
if [[ $pointer_status -eq 0 ]]; then
  pointer_exists=true
  aws s3api get-object --bucket "$R2_BUCKET" --key channels/beta-pointer.json manifest/current-pointer.json > /dev/null
  current_generation="$(jq -er '.generation' manifest/current-pointer.json)"
  aws s3api get-object --bucket "$R2_BUCKET" --key "generations/${current_generation}/legacy/beta.json" manifest/current.json > /dev/null
elif grep -Eq '404|Not Found|NoSuchKey' manifest/current-pointer-head.err; then
  set +e
  aws s3api head-object --bucket "$R2_BUCKET" --key channels/beta.json > manifest/current-head.json 2> manifest/current-head.err
  legacy_status=$?
  set -e
  if [[ $legacy_status -eq 0 ]]; then
    aws s3api get-object --bucket "$R2_BUCKET" --key channels/beta.json manifest/current.json > /dev/null
    legacy_exists=true
  elif ! grep -Eq '404|Not Found|NoSuchKey' manifest/current-head.err; then
    cat manifest/current-head.err >&2
    exit "$legacy_status"
  fi
else
  cat manifest/current-pointer-head.err >&2
  exit "$pointer_status"
fi

current_path='-'
[[ -f manifest/current.json ]] && current_path='manifest/current.json'
node scripts/release/verify-update-transition.mjs "$current_path" manifest/beta.json "$version"

mkdir -p manifest/electron
while IFS=$'\t' read -r key target filename; do
  target_file="${target//:/-}"
  mkdir -p "manifest/electron/${target_file}"
  aws s3api get-object --bucket "$R2_BUCKET" --key "$key" "manifest/electron/${target_file}/${filename}" > /dev/null
done < <(jq -s -r '[.[].artifacts[] | select(.kind == "metadata")] | sort_by(.platform,.arch,.variant) | .[] | [.key,(.platform+":"+.arch+":"+.variant),.filename] | @tsv' "${metadata[@]}")

mapfile -t electron_specs < <(node scripts/release/print-electron-updater-verify-specs.mjs)
node scripts/release/verify-electron-updater-generation.mjs \
  "$version" \
  "${electron_specs[@]}" \
  --artifact-metadata "${metadata[@]}"

if [[ -f manifest/current.json ]]; then
  aws s3api put-object --bucket "$R2_BUCKET" --key channels/beta.previous.json --body manifest/current.json --content-type application/json --cache-control no-store
  if [[ "$pointer_exists" == true ]]; then
    aws s3api put-object --bucket "$R2_BUCKET" --key channels/beta.previous-pointer.json --body manifest/current-pointer.json --content-type application/json --cache-control no-store
  fi
fi

legacy_args=(--if-none-match '*')
if [[ "$legacy_exists" == true || ( "$pointer_exists" == false && -f manifest/current.json ) ]]; then
  legacy_etag="$(jq -r '.ETag' manifest/current-head.json 2>/dev/null || jq -r '.ETag' manifest/current-pointer-head.json)"
  legacy_args=(--if-match "$legacy_etag")
fi
pointer_args=(--if-none-match '*')
if [[ "$pointer_exists" == true ]]; then
  pointer_etag="$(jq -r '.ETag' manifest/current-pointer-head.json)"
  pointer_args=(--if-match "$pointer_etag")
fi

if [[ "$pointer_exists" == true ]]; then
  aws s3api put-object --bucket "$R2_BUCKET" --key channels/beta.json --body manifest/beta.json --content-type application/json --cache-control no-store "${legacy_args[@]}" > /dev/null
  aws s3api put-object --bucket "$R2_BUCKET" --key channels/beta-pointer.json --body manifest/beta-pointer.json --content-type application/json --cache-control no-store "${pointer_args[@]}" > /dev/null
else
  aws s3api put-object --bucket "$R2_BUCKET" --key channels/beta-pointer.json --body manifest/beta-pointer.json --content-type application/json --cache-control no-store "${pointer_args[@]}" > /dev/null
  aws s3api put-object --bucket "$R2_BUCKET" --key channels/beta.json --body manifest/beta.json --content-type application/json --cache-control no-store "${legacy_args[@]}" > /dev/null
fi

mapfile -t release_targets < <(node scripts/release/print-required-release-targets.mjs)
node scripts/release/verify-published-update.mjs --channel beta \
  "$version" \
  "${release_targets[@]}"

echo "Published beta platform stage ${platform} for ${version}"
