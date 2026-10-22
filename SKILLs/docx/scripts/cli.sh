#!/usr/bin/env bash
# Resolve the DOCX CLI used by SKILL.md's `$CLI` shorthand.
#
# Order:
#   1. $ZHIYUAN_DOCX_CLI                 (explicit override, tests, enterprise builds)
#   2. <skill>/runtime/MiniMaxAIDocx.exe (self-contained publish, needs no .NET)
#   3. dotnet run --project dotnet/MiniMaxAIDocx.Cli (developer machines with the SDK)
#
# Keeping this in one wrapper means SKILL.md never has to know how the CLI is
# delivered, and a machine without .NET still works when the runtime is bundled.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -n "${ZHIYUAN_DOCX_CLI:-}" ] && [ -x "${ZHIYUAN_DOCX_CLI}" ]; then
  exec "${ZHIYUAN_DOCX_CLI}" "$@"
fi

for candidate in \
  "$SKILL_DIR/runtime/MiniMaxAIDocx.Cli.exe" \
  "$SKILL_DIR/runtime/MiniMaxAIDocx.exe" \
  "$SKILL_DIR/runtime/MiniMaxAIDocx.Cli" \
  "$SKILL_DIR/runtime/MiniMaxAIDocx"; do
  if [ -x "$candidate" ]; then
    exec "$candidate" "$@"
  fi
done

if command -v dotnet >/dev/null 2>&1; then
  exec dotnet run --project "$SKILL_DIR/scripts/dotnet/MiniMaxAIDocx.Cli" -- "$@"
fi

echo "docx CLI unavailable: no bundled runtime and no dotnet SDK on PATH." >&2
echo "Build it with: node scripts/build-docx-runtime.cjs" >&2
exit 3
