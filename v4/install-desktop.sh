#!/usr/bin/env bash
# Install this checkout's v4 desktop build on Ubuntu. Run as the desktop user.
set -euo pipefail

if (( EUID == 0 )); then
    echo "Run as your desktop user, without sudo; package installation will request sudo." >&2
    exit 1
fi
if [[ $(uname -m) != x86_64 ]]; then
    echo "This installer requires Ubuntu x86_64 with Google Chrome." >&2
    exit 1
fi
command -v apt-get >/dev/null || { echo "This installer requires Ubuntu/apt-get." >&2; exit 1; }

source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
config_dir=${XDG_CONFIG_HOME:-"$HOME/.config"}
bin_dir="$HOME/.local/bin"
unit_dir="$config_dir/systemd/user"
mkdir -p "${TMPDIR:-"$source_dir/tmp"}"
work_dir=$(mktemp -d "${TMPDIR:-"$source_dir/tmp"}/voice-type-install.XXXXXX")
trap 'rm -rf -- "$work_dir"' EXIT

packages=(ca-certificates curl git unzip build-essential libxcb1-dev xdotool python3-gi
    gir1.2-gtk-3.0 gir1.2-ayatanaappindicator3-0.1 gnome-shell-extension-appindicator)
missing=()
for package in "${packages[@]}"; do
    if [[ $(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true) != 'install ok installed' ]]; then
        missing+=("$package")
    fi
done
if (( ${#missing[@]} )); then
    sudo apt-get update
    sudo apt-get install -y "${missing[@]}"
fi

browser=$(command -v google-chrome || command -v google-chrome-stable || true)
if [[ -z $browser ]]; then
    curl -fL --retry 3 https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
        -o "$work_dir/google-chrome.deb"
    sudo apt-get install -y "$work_dir/google-chrome.deb"
    browser=$(command -v google-chrome || command -v google-chrome-stable)
fi

export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun >/dev/null; then
    curl -fL --retry 3 https://bun.sh/install -o "$work_dir/install-bun.sh"
    BUN_INSTALL="$HOME/.bun" bash "$work_dir/install-bun.sh" bun-v1.3.14
fi

# Finish the build before touching the working installation or its service.
(
    cd "$source_dir"
    bun install
    bun build src/index.ts --compile --outfile "$work_dir/voice-type"
)
mkdir -p "$bin_dir" "$config_dir" "$unit_dir" "$config_dir/autostart"
config_file="$config_dir/voice-type.jsonc"
if [[ ! -e $config_file && ! -L $config_file ]]; then
    python3 - "$config_file" "$browser" <<'PY'
import json, sys
with open(sys.argv[1], 'x') as f:
    json.dump(dict(port=3232, lang='vi-VN', browser_type='chrome', browser_path=sys.argv[2],
                   stream=True, timeout=0, sound=False, text=False, punctuation=True), f, indent=4)
    f.write('\n')
PY
fi

cat > "$work_dir/voice-type.service" <<'UNIT'
[Unit]
Description=Voice Type v4 dictation
After=graphical-session.target
PartOf=graphical-session.target
ConditionEnvironment=DISPLAY
ConditionEnvironment=!XDG_SESSION_TYPE=wayland

[Service]
Type=simple
ExecStart="%h/.local/bin/voice-type" --desktop
Environment="PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin"
TimeoutStopSec=10

[Install]
WantedBy=graphical-session.target
UNIT

# Import the current session's X11 credentials, including after logout/login.
cat > "$work_dir/voice-type-session" <<'SESSION'
#!/bin/sh
if [ -z "${DISPLAY:-}" ] || [ "${XDG_SESSION_TYPE:-}" = wayland ]; then
    exit 0
fi
systemctl --user import-environment DISPLAY XAUTHORITY XDG_SESSION_TYPE
exec systemctl --user start voice-type.service
SESSION
cat > "$work_dir/voice-type.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Voice Type
Comment=Start Vietnamese dictation with microphone tray controls
Exec=/bin/sh -c "exec \"\$HOME/.local/bin/voice-type-session\""
Terminal=false
X-GNOME-Autostart-enabled=true
DESKTOP

changed=0
bus_available=0
if systemctl --user show-environment >/dev/null 2>&1; then bus_available=1; fi
if ! cmp -s "$work_dir/voice-type" "$bin_dir/voice-type"; then
    if (( bus_available )) && systemctl --user is-active --quiet voice-type.service; then
        systemctl --user stop voice-type.service
    fi
    # Rename atomically; do not truncate a running executable.
    install -m 755 "$work_dir/voice-type" "$bin_dir/.voice-type.new"
    mv -f "$bin_dir/.voice-type.new" "$bin_dir/voice-type"
    changed=1
fi
if ! cmp -s "$work_dir/voice-type.service" "$unit_dir/voice-type.service"; then
    install -m 644 "$work_dir/voice-type.service" "$unit_dir/voice-type.service"
    changed=1
fi
install -m 755 "$work_dir/voice-type-session" "$bin_dir/voice-type-session"
install -m 644 "$work_dir/voice-type.desktop" "$config_dir/autostart/voice-type.desktop"
# Replace the older default.target activation with graphical-session activation.
if [[ -L "$unit_dir/default.target.wants/voice-type.service" ]]; then
    systemctl --user --no-reload disable voice-type.service
fi
systemctl --user --no-reload enable voice-type.service
if (( bus_available )); then
    if (( changed )); then systemctl --user daemon-reload; fi
    if [[ -n ${DISPLAY:-} && ${XDG_SESSION_TYPE:-} != wayland ]]; then
        systemctl --user import-environment DISPLAY XAUTHORITY XDG_SESSION_TYPE
        if (( changed )); then
            systemctl --user restart voice-type.service
        else
            systemctl --user start voice-type.service
        fi
        systemctl --user is-active --quiet voice-type.service
    fi
fi
if command -v gnome-extensions >/dev/null && [[ -n ${DISPLAY:-} ]]; then
    gnome-extensions enable ubuntu-appindicators@ubuntu.com 2>/dev/null ||
        echo "Log out and back in to load the installed AppIndicator extension."
fi
printf 'Voice Type v4 installed: %s\nConfig preserved: %s\n' "$bin_dir/voice-type" "$config_file"
if [[ -z ${DISPLAY:-} || ${XDG_SESSION_TYPE:-} == wayland ]]; then
    echo 'Select "Ubuntu on Xorg" at login. Voice Type starts automatically in that session.'
fi
