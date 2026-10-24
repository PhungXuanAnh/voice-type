# v4

The `voice-type` user service runs the compiled binary at `~/.local/bin/voice-type`, not the
source tree. After changing v4 code, rebuild and reinstall it before testing the service,
otherwise the service keeps running the old build:

```sh
bun build src/index.ts --compile --outfile build/voice-type
install -m 755 build/voice-type ~/.local/bin/voice-type
systemctl --user restart voice-type
```
