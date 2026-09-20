#!/bin/zsh
# Builds the app and wraps it as "Chess Sensei.app" in ~/Applications (drag it to the Dock).
#   npm run app
# The .app is a thin launcher: it starts scripts/serve.mjs from THIS checkout if it isn't already
# running, then opens the app in a chromeless browser window. Re-run after pulling changes.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
PORT=5180
APP="$HOME/Applications/Chess Sensei.app"

cd "$REPO"
npm run build

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Icon: PNG -> .icns
ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s public/icon-512.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d public/icon-512.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Chess Sensei</string>
  <key>CFBundleIdentifier</key><string>local.chesssensei.launcher</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppleEventsUsageDescription</key><string>Chess Sensei brings its existing window to the front instead of opening a new one.</string>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/launch" <<LAUNCH
#!/bin/zsh
PORT=$PORT
URL="http://localhost:\$PORT"
LOG="\$HOME/Library/Logs/ChessSensei.log"

if ! nc -z 127.0.0.1 \$PORT 2>/dev/null; then
  nohup "$NODE" "$REPO/scripts/serve.mjs" \$PORT >>"\$LOG" 2>&1 &
  for i in {1..50}; do nc -z 127.0.0.1 \$PORT 2>/dev/null && break; sleep 0.1; done
fi

# If a window for the app is already open, bring it forward instead of opening another one.
# (First use asks for permission to control the browser; if that is declined we just open a window.)
focus_existing() {
  pgrep -xq "\$1" || return 1
  /usr/bin/osascript 2>/dev/null <<OSA | grep -q found
tell application "\$1"
  repeat with w in windows
    repeat with t in tabs of w
      if URL of t starts with "\$URL" then
        set index of w to 1
        activate
        return "found"
      end if
    end repeat
  end repeat
end tell
OSA
}

# A chromeless "app" window when a Chromium browser is around, otherwise the default browser.
for B in "Google Chrome" "Brave Browser" "Microsoft Edge"; do
  if [ -d "/Applications/\$B.app" ]; then
    focus_existing "\$B" && exit 0
    exec open -na "\$B" --args --app="\$URL" --window-size=1360,900
  fi
done
exec open "\$URL"
LAUNCH
chmod +x "$APP/Contents/MacOS/launch"

echo "\nBuilt: $APP\nDrag it to your Dock. It serves $REPO/dist on http://localhost:$PORT."
