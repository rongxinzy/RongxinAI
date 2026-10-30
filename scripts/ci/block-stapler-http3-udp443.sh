#!/usr/bin/env bash
# GitHub-hosted macOS runners can fail xcrun stapler against api.apple-cloudkit.com
# (Error 68 / NSURLErrorDomain -1005) because stapler prefers HTTP/3 over UDP/443.
# Block outbound UDP/443 for this job so stapler falls back to HTTPS/TCP.
# https://github.com/actions/runner-images/issues/14924
set -euo pipefail

if [[ "$(uname -s)" != 'Darwin' ]]; then
  echo 'block-stapler-http3-udp443.sh is macOS-only' >&2
  exit 1
fi

echo 'Applying pfctl rule: block outbound UDP/443 (stapler HTTP/3 workaround)'
echo 'block return out quick proto udp from any to any port 443' | sudo pfctl -f -
sudo pfctl -E
