#!/usr/bin/env bash
# PROVIEW SIGNAGE player for Raspberry Pi.
# Turns a Raspberry Pi (Raspberry Pi OS with desktop) into a signage player that starts by itself.
#
#   Install:  curl -fsSL https://app.proviewsignage.co.uk/pi/install.sh | bash
#   Remove:   curl -fsSL https://app.proviewsignage.co.uk/pi/install.sh | bash -s -- --remove
set -euo pipefail

PLAYER_URL="https://app.proviewsignage.co.uk/player.html"
VERSION="1.0"
DIR="$HOME/proview-signage"
START="$DIR/start.sh"
DESKTOP="$HOME/.config/autostart/proview-signage.desktop"
LABWC="$HOME/.config/labwc/autostart"
WAYFIRE="$HOME/.config/wayfire.ini"
MARK="# proview-signage"

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }

if [ "$(id -u)" = "0" ]; then
  echo "Run this as the normal desktop user (for example 'pi'), not with sudo."; exit 1
fi

remove() {
  say "Removing the PROVIEW SIGNAGE player"
  rm -f "$DESKTOP"
  [ -f "$LABWC" ] && sed -i "/$MARK/d" "$LABWC"
  [ -f "$WAYFIRE" ] && sed -i "/^proview-signage *=/d" "$WAYFIRE"
  pkill -f "$START" 2>/dev/null || true
  rm -rf "$DIR"
  echo "Removed. Restart the Pi to finish."
}
if [ "${1:-}" = "--remove" ]; then remove; exit 0; fi

say "PROVIEW SIGNAGE player for Raspberry Pi (v$VERSION)"

# 1. Chromium (already on Raspberry Pi OS with desktop; installed here if missing)
BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then
  say "Installing Chromium"
  sudo apt-get update -y
  sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser
  BROWSER="$(command -v chromium-browser || command -v chromium || true)"
fi
[ -n "$BROWSER" ] || { echo "Chromium could not be installed. Use Raspberry Pi OS with desktop."; exit 1; }

# 2. A fixed ID for this Pi (made from its serial number), so its licence and free trial stay with the device
SERIAL="$(tr -d '\0' < /sys/firmware/devicetree/base/serial-number 2>/dev/null || true)"
[ -n "$SERIAL" ] || SERIAL="$(awk -F': ' '/^Serial/ {print $2}' /proc/cpuinfo 2>/dev/null || true)"
[ -n "$SERIAL" ] || SERIAL="$(cat /etc/machine-id)"
HW="$(printf 'proview-pi:%s' "$SERIAL" | sha256sum | cut -c1-64)"
MODEL="$(tr -d '\0' < /sys/firmware/devicetree/base/model 2>/dev/null || echo 'Raspberry Pi')"
MODEL_Q="$(printf '%s' "$MODEL" | sed 's/[^A-Za-z0-9._-]/+/g')"

# 3. The start script: waits for the internet, then keeps the player open full screen
mkdir -p "$DIR"
cat > "$START" <<EOF
#!/usr/bin/env bash
# Started automatically when the desktop loads. Only one copy runs at a time.
exec 9>"$DIR/lock"; flock -n 9 || exit 0
URL="$PLAYER_URL?hw=$HW&app=pi-$VERSION&model=$MODEL_Q"
# keep the screen awake (X11 desktops; harmless elsewhere)
xset s off -dpms s noblank 2>/dev/null || true
command -v unclutter >/dev/null && (unclutter -idle 1 -root &) 2>/dev/null || true
# wait up to 2 minutes for the internet
for i in \$(seq 1 60); do curl -fsI --max-time 4 "$PLAYER_URL" >/dev/null 2>&1 && break; sleep 2; done
while true; do
  # stop Chromium showing "restore pages?" after a power cut
  sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$DIR/profile/Default/Preferences" 2>/dev/null || true
  "$BROWSER" --kiosk --user-data-dir="$DIR/profile" --no-first-run --noerrdialogs --disable-infobars \\
    --disable-session-crashed-bubble --disable-features=Translate,TranslateUI --disable-pinch --overscroll-history-navigation=0 \\
    --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 --password-store=basic \\
    "\$URL" >/dev/null 2>&1 || true
  sleep 3   # if the player ever closes or crashes, open it again
done
EOF
chmod +x "$START"

# 4. Start with the desktop. Raspberry Pi OS has used three desktops; set all three (the lock stops double starts).
mkdir -p "$(dirname "$DESKTOP")"
cat > "$DESKTOP" <<EOF
[Desktop Entry]
Type=Application
Name=PROVIEW SIGNAGE player
Exec=$START
X-GNOME-Autostart-enabled=true
EOF
mkdir -p "$(dirname "$LABWC")"; touch "$LABWC"; sed -i "/$MARK/d" "$LABWC"
echo "$START & $MARK" >> "$LABWC"
if [ -f "$WAYFIRE" ]; then
  sed -i "/^proview-signage *=/d" "$WAYFIRE"
  grep -q '^\[autostart\]' "$WAYFIRE" || printf '\n[autostart]\n' >> "$WAYFIRE"
  sed -i "/^\[autostart\]/a proview-signage = $START" "$WAYFIRE"
fi

# 5. Pi settings: boot to the desktop signed in, never blank the screen (best effort)
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_boot_behaviour B4 2>/dev/null || true
  sudo raspi-config nonint do_blanking 1 2>/dev/null || true
fi
sudo apt-get install -y unclutter >/dev/null 2>&1 || true

say "Done."
cat <<EOF
This Pi's device ID: ${HW:0:8}  (shows as "TV ID" in the dashboard)

Restart the Pi now:   sudo reboot

After it restarts, the pairing code and QR appear on the screen.
Pair it from the Screens page at app.proviewsignage.co.uk.

The player reopens by itself if it is closed. To take it off this Pi, run the Remove
command shown at app.proviewsignage.co.uk/pi (over SSH, or from a terminal).
EOF
