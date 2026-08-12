#!/bin/bash
set -e

# Script to regenerate macOS .icns file from PNG icons for better compatibility
# This ensures the icon works correctly on both Intel and Apple Silicon Macs

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ICON_DIR="$PROJECT_ROOT/build/icons"
PNG_DIR="$ICON_DIR/png"
MAC_DIR="$ICON_DIR/mac"
ICONSET_DIR="$MAC_DIR/icon.iconset"

echo "🎨 Regenerating macOS icon for better compatibility..."

# Check if source PNG exists
if [ ! -f "$PNG_DIR/icon_512x512.png" ]; then
    echo "❌ Error: Source PNG not found at $PNG_DIR/icon_512x512.png"
    echo "   Please ensure PNG icons are extracted first."
    exit 1
fi

# Create iconset directory
rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

# Copy PNG files to iconset with correct naming
for size in 16 32 128 256 512; do
    if [ -f "$PNG_DIR/icon_${size}x${size}.png" ]; then
        cp "$PNG_DIR/icon_${size}x${size}.png" "$ICONSET_DIR/icon_${size}x${size}.png"
        echo "  ✓ Added ${size}x${size}"
    fi

    # Copy @2x versions
    doubled=$((size * 2))
    if [ -f "$PNG_DIR/icon_${size}x${size}@2x.png" ]; then
        cp "$PNG_DIR/icon_${size}x${size}@2x.png" "$ICONSET_DIR/icon_${size}x${size}@2x.png"
        echo "  ✓ Added ${size}x${size}@2x (${doubled}x${doubled})"
    fi
done

# Backup old icon
if [ -f "$MAC_DIR/icon.icns" ]; then
    mv "$MAC_DIR/icon.icns" "$MAC_DIR/icon.icns.backup"
    echo "📦 Backed up old icon to icon.icns.backup"
fi

# Generate new .icns file using iconutil
iconutil -c icns "$ICONSET_DIR" -o "$MAC_DIR/icon.icns"

if [ $? -eq 0 ]; then
    echo "✅ Successfully generated new icon.icns"

    # Show file info
    ls -lh "$MAC_DIR/icon.icns"
    file "$MAC_DIR/icon.icns"

    # Clean up
    rm -rf "$ICONSET_DIR"
    echo "🧹 Cleaned up temporary iconset directory"
else
    echo "❌ Failed to generate icon.icns"
    # Restore backup if generation failed
    if [ -f "$MAC_DIR/icon.icns.backup" ]; then
        mv "$MAC_DIR/icon.icns.backup" "$MAC_DIR/icon.icns"
        echo "♻️  Restored original icon"
    fi
    exit 1
fi

echo ""
echo "🎉 Icon regeneration complete!"
echo "   The new icon should work correctly on both Intel and Apple Silicon Macs."
echo "   You can now rebuild the app with: npm run dist:mac"
