#!/bin/zsh
# Builds the native Mac app shell into /Applications/Transcript Desk.app —
# its own window, menu bar, and Dock icon (no browser, no Electron).
# Needs only Apple's Command Line Tools (xcode-select --install).
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="/Applications/Transcript Desk.app"

echo "Compiling native shell…"
cd "$APP_DIR/native"
clang -fobjc-arc -O2 -framework Cocoa -framework WebKit -o TranscriptDesk main.m

echo "Assembling $BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
cp TranscriptDesk "$BUNDLE/Contents/MacOS/TranscriptDesk"

cat > "$BUNDLE/Contents/Info.plist" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleName</key>
    <string>Transcript Desk</string>
    <key>CFBundleDisplayName</key>
    <string>Transcript Desk</string>
    <key>CFBundleIdentifier</key>
    <string>com.transcript-desk.app</string>
    <key>CFBundleExecutable</key>
    <string>TranscriptDesk</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleShortVersionString</key>
    <string>1.4</string>
    <key>CFBundleVersion</key>
    <string>1.4</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST_EOF

echo "Generating icon…"
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s icon.png --out "$ICONSET/icon_${s}x${s}.png" > /dev/null
  sips -z $((s*2)) $((s*2)) icon.png --out "$ICONSET/icon_${s}x${s}@2x.png" > /dev/null
done
iconutil -c icns "$ICONSET" -o "$BUNDLE/Contents/Resources/AppIcon.icns"

codesign -s - --force --deep "$BUNDLE"
echo
echo "Done — find “Transcript Desk” in Spotlight or /Applications."
echo "(The app expects the service on port 3999 — run Scripts/install-service.sh first.)"
