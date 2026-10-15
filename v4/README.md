# Voice Type v4 — desktop debugging

On Ubuntu x86_64, install this fork's desktop version as your normal user:

```sh
git clone https://github.com/PhungXuanAnh/voice-type.git ~/repo/voice-type
bash ~/repo/voice-type/v4/install-desktop.sh
```

The installer installs Chrome, Bun and desktop dependencies, builds v4 into
`~/.local/bin/voice-type`, and configures one user service and one login entry.
It defaults new configurations to `vi-VN`; existing `voice-type.jsonc` files are
preserved. Select **Ubuntu on Xorg** at login. Installation without an active
desktop session is supported; the app starts at the next Xorg login.

To update, use `git -C ~/repo/voice-type pull --ff-only` and rerun the same
installer. Repeated runs preserve your configuration and do not duplicate
services or login entries. The build completes before replacing the installed
binary. Do not use the upstream release installer or `voice-type update` for
this source-built fork.

Keyboard shortcut → curl → local daemon → Puppeteer → Chrome Web Speech API →
transcripts → X11 UTF-8 paste (or dotool on Wayland) → focused application's text field. Chrome runs a private
local recognition page, not Google Translate.

```sh
# Stop the service before running a foreground instance on the same port.
systemctl --user stop voice-type
voice-type --debug    # Visible Chrome + terminal logs; preview only, no typing.
voice-type --desktop  # Visible Chrome + tray; types into the focused application.
voice-type            # Original headless mode.
```

For source development: `bun install`, then `bun run src/index.ts --debug`.
Desktop modes require Linux X11, Chrome, cc/libxcb headers and system Python with
GTK3; on GNOME the tray icon needs the AppIndicator extension (it also hosts legacy tray icons).
Ubuntu desktop dependencies: `build-essential libxcb1-dev python3-gi gir1.2-gtk-3.0`.
All X11 modes also require `xdotool` (`sudo apt install xdotool`).
Headless mode does not require those desktop dependencies.

On X11, text is pasted with Shift+Insert to preserve Vietnamese accents with input
methods such as IBus Bamboo. The focused application must support this paste shortcut.
Dictation replaces both the clipboard and primary selection with the latest inserted
text fragment; previous clipboard contents are not restored. Line breaks and control
characters in transcripts become spaces, so ordinary dictation does not press Enter.
Explicit spoken key commands remain available in languages that support them.

The Chrome page shows microphone state, transcripts and errors. In either desktop or debug mode,
click **Thử nhận giọng nói**, speak, then **Dừng**. F12 opens DevTools.
In desktop mode, select a text field in another application and use a shortcut:

```sh
curl -fsS 'http://127.0.0.1:3232/toggle?lang=vi-VN'
```

Native **X / Alt+F4** hides the window without unloading its page or stopping
dictation. The microphone is white while idle and red while Chrome is recording,
including preview mode. Left-click the tray microphone to start or stop dictation in the
selected language, like the shortcut; right-click it for a menu with **Mở Chrome / kiểm tra**, **Dừng nhận
giọng nói** and **Thoát Voice Type**. Closing an individual tab still closes that
tab; opening from the tray recreates the recognition page if needed.

```sh
curl -fsS http://127.0.0.1:3232/preview # Start preview without typing elsewhere.
curl -fsS http://127.0.0.1:3232/status  # Actual recognition state, mode and error.
curl -fsS http://127.0.0.1:3232/show    # Restore owned Chrome.
curl -fsS http://127.0.0.1:3232/stop
```

Configuration: `~/.config/voice-type.jsonc`. Background logs:
`~/.local/share/voice-type/logs/voice-type.log`. Debug logs go to stdout and include
transcript text. Chrome uses a temporary isolated profile. The native close
interceptor applies only to the owned Chrome PID and window class.

After debugging, Ctrl+C then `systemctl --user start voice-type` returns to the
configured service. Its ExecStart must use `--desktop` for tray support.
Avoid `voice-type update` if you want to retain this local build.

To select an input in the owned Chrome window, stop dictation, click **Tải danh sách micro**,
then choose a **Micro** before starting preview or dictation with a shortcut.
The selection lasts for this Chrome session; restarting returns to the system default.
An unavailable selected device reports an error instead of silently using another microphone.
Selecting a specific device requires Chrome 135 or newer (`SpeechRecognition.start(audioTrack)`).

Use **Ngôn ngữ nhận giọng nói** to choose any supported language before recording.
This sets the default for preview and keyboard shortcuts for the current daemon session;
restarting restores the configured `lang`. A shortcut with an explicit `?lang=...` still overrides it.
