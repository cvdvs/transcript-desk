#!/bin/zsh
# Installs Transcript Desk as a login service: builds the app, writes a
# LaunchAgent with YOUR node path and repo location, and starts it.
# Re-run any time — it replaces the previous service definition.
set -e

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
PLIST="$HOME/Library/LaunchAgents/com.transcript-desk.plist"
PORT="3999" # fixed — the native shell and phone links assume it

if [ -z "$NODE_BIN" ]; then
  echo "node not found on PATH — install Node.js first." >&2
  exit 1
fi

echo "Building…"
cd "$APP_DIR"
npm install
npm run build

# the OCR helper (Apple Vision) powers text capture from images — optional
if command -v clang > /dev/null && [ ! -f native/ocr ]; then
  echo "Building the OCR tool…"
  (cd native && clang -fobjc-arc -O2 -framework Foundation -framework ImageIO \
    -framework Vision -framework CoreGraphics -o ocr ocr.m) || \
    echo "(OCR build failed — image text capture will be disabled)"
fi

echo "Writing $PLIST"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.transcript-desk</string>
    <key>WorkingDirectory</key>
    <string>${APP_DIR}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>node_modules/next/dist/bin/next</string>
        <string>start</string>
        <string>-p</string>
        <string>${PORT}</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$(dirname "$NODE_BIN"):${PATH}</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/transcript-desk.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/transcript-desk.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
echo
echo "Transcript Desk is running → http://localhost:${PORT}"
echo "It starts itself at every login. Logs: ~/Library/Logs/transcript-desk.log"
