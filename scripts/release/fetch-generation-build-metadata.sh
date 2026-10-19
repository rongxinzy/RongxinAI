#!/usr/bin/env bash
# Download every update-artifacts-*.json archived for a release generation from R2.
set -euo pipefail

version="${1:?release version required}"
dest="${2:-uploaded-metadata}"
bucket="${R2_BUCKET:?R2_BUCKET is required}"

mkdir -p "$dest"
prefix="generations/${version}/build-metadata/"

mapfile -t keys < <(
  aws s3api list-objects-v2 --bucket "$bucket" --prefix "$prefix" \
    | jq -r '.Contents[]?.Key | select(test("update-artifacts-[0-9]+\\.json$"))' \
    | sort
)

if [[ ${#keys[@]} -eq 0 ]]; then
  echo "No update-artifacts metadata found under s3://${bucket}/${prefix}" >&2
  exit 1
fi

expected_count="$(
  node --input-type=module -e "
    import { listReleaseCandidateBundles } from './scripts/release/release-candidate-layout.mjs';
    import { resolveReleasePlatforms } from './scripts/release/release-platform-stages.mjs';
    process.stdout.write(String(listReleaseCandidateBundles(resolveReleasePlatforms(process.env)).length));
  "
)"

if [[ ${#keys[@]} -ne "$expected_count" ]]; then
  echo "Expected ${expected_count} artifact metadata files, found ${#keys[@]} under ${prefix}" >&2
  exit 1
fi

for key in "${keys[@]}"; do
  aws s3api get-object --bucket "$bucket" --key "$key" "${dest}/$(basename "$key")" > /dev/null
done

echo "Fetched ${#keys[@]} build metadata file(s) for generation ${version}"
