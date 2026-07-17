#!/bin/bash
set -euo pipefail

echo "============================================"
echo " Sandbox VM Image Builder (WSL)"
echo "============================================"

PROJECT=/mnt/d/project/zhiyuan
BROOT=/root/sandbox-build
OUTDIR=$PROJECT/sandbox/image/out

echo "[1/6] Preparing build directory..."
rm -rf "$BROOT"
mkdir -p "$BROOT/sandbox/image"
mkdir -p "$BROOT/sandbox/agent-runner"

cp "$PROJECT/sandbox/image/build.sh" "$BROOT/sandbox/image/build.sh"
cp -r "$PROJECT/sandbox/image/overlay" "$BROOT/sandbox/image/overlay"
cp "$PROJECT/sandbox/agent-runner/index.js" "$BROOT/sandbox/agent-runner/"
cp "$PROJECT/sandbox/agent-runner/package.json" "$BROOT/sandbox/agent-runner/"
if [ -f "$PROJECT/sandbox/agent-runner/AGENT_SYSTEM_PROMPT.md" ]; then
    cp "$PROJECT/sandbox/agent-runner/AGENT_SYSTEM_PROMPT.md" "$BROOT/sandbox/agent-runner/"
fi

echo "[2/6] Fixing line endings with dos2unix..."
find "$BROOT" -type f \( -name "*.sh" -o -name "*.js" -o -name "*.json" -o -name "*.md" \) -exec dos2unix -q {} +
find "$BROOT/sandbox/image/overlay/etc" -type f -exec dos2unix -q {} +
chmod +x "$BROOT/sandbox/image/build.sh"

echo "[3/6] Build files:"
find "$BROOT" -type f | head -20
echo ""

echo "[4/6] Starting image build (arch: amd64)..."
mkdir -p "$OUTDIR"
cd "$BROOT/sandbox/image"
ARCHS=amd64 AGENT_RUNNER_BUILD=auto OUT_DIR="$OUTDIR" ./build.sh

echo ""
echo "[5/6] Checking output..."
if [ -f "$OUTDIR/linux-amd64.qcow2" ]; then
    SIZE=$(stat -c%s "$OUTDIR/linux-amd64.qcow2")
    echo "  SUCCESS: linux-amd64.qcow2 ($SIZE bytes)"
else
    echo "  ERROR: Output file not found!"
    ls -la "$OUTDIR/" 2>/dev/null || true
    exit 1
fi

echo "[6/6] Cleanup..."
rm -rf "$BROOT"
echo "Build complete!"
