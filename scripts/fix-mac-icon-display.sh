#!/bin/bash
set -e

# Post-build script so Launchpad and the Dock use icon.icns.
# CFBundleIconName without an Assets.car makes macOS ignore icon.icns and
# show the Electron default icon.

echo "Applying macOS Launchpad icon fix..."

if [ -z "$1" ]; then
    echo "Usage: $0 <path-to-app>"
    echo "Example: $0 release/mac-arm64/知远.app"
    exit 1
fi

APP_PATH="$1"
RESOURCES_PATH="$APP_PATH/Contents/Resources"
INFO_PLIST="$APP_PATH/Contents/Info.plist"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: App not found at $APP_PATH"
    exit 1
fi

if [ ! -f "$INFO_PLIST" ]; then
    echo "❌ Error: Info.plist not found at $INFO_PLIST"
    exit 1
fi

echo "  App: $APP_PATH"

# CFBundleIconName is for Asset Catalog icons. This bundle only has icon.icns.
if plutil -extract CFBundleIconName raw "$INFO_PLIST" &>/dev/null; then
    echo "  Removing CFBundleIconName so Launchpad uses icon.icns..."
    plutil -remove CFBundleIconName "$INFO_PLIST"
    echo "  ✓ CFBundleIconName removed"
else
    echo "  ✓ CFBundleIconName is not set"
fi

if plutil -extract CFBundleIconFile raw "$INFO_PLIST" &>/dev/null; then
    plutil -replace CFBundleIconFile -string "icon.icns" "$INFO_PLIST"
else
    plutil -insert CFBundleIconFile -string "icon.icns" "$INFO_PLIST"
fi
echo "  ✓ CFBundleIconFile set to icon.icns"

# Verify icon file exists
ICON_FILE="$RESOURCES_PATH/icon.icns"
if [ ! -f "$ICON_FILE" ]; then
    echo "  ⚠️  Warning: icon.icns not found at $ICON_FILE"
else
    FILE_SIZE=$(stat -f%z "$ICON_FILE" 2>/dev/null || stat -c%s "$ICON_FILE" 2>/dev/null)
    echo "  ✓ icon.icns found ($(numfmt --to=iec-i --suffix=B $FILE_SIZE 2>/dev/null || echo $FILE_SIZE bytes))"
fi

# Update the app's extended attributes to clear any cached icon data
echo "  🧹 Clearing icon cache..."
xattr -cr "$APP_PATH" 2>/dev/null || true

# Touch the app to update modification time
touch "$APP_PATH"

# Force icon cache refresh by touching Resources directory
touch "$RESOURCES_PATH"

echo ""
echo "✅ Icon fix applied successfully!"
echo ""
echo "📝 Next steps:"
echo "   1. If the app is signed, you may need to re-sign it:"
echo "      codesign --force --deep --sign - \"$APP_PATH\""
echo ""
echo "   2. Clear system icon cache (optional, may require restart):"
echo "      sudo rm -rf /Library/Caches/com.apple.iconservices.store"
echo "      killall Dock"
echo ""
echo "   3. Open Launchpad and confirm the app icon is the product logo"
