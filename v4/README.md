# Voice Type v4 — desktop debugging

Keyboard shortcut → curl → local daemon → Puppeteer → Chrome Web Speech API →
transcripts → dotool → focused application's text field. Chrome runs a private
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
GTK3 and Ayatana AppIndicator (or AppIndicator). Ubuntu desktop dependencies:
`build-essential libxcb1-dev python3-gi gir1.2-ayatanaappindicator3-0.1`.
Headless mode does not require those desktop dependencies.

The Chrome page shows microphone state, transcripts and errors. In either desktop or debug mode,
click **Thử nhận giọng nói**, speak, then **Dừng**. F12 opens DevTools.
In desktop mode, select a text field in another application and use a shortcut:

```sh
curl -fsS 'http://127.0.0.1:3232/toggle?lang=vi-VN'
```

Native **X / Alt+F4** hides the window without unloading its page or stopping
dictation. The microphone tray menu provides **Mở Chrome / kiểm tra**, **Dừng nhận
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
