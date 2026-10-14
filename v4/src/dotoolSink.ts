import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import { X11TypingSink } from "./x11TypingSink.js"
import { log } from "./logger.js"

export interface DotoolSink {
    readonly ready?: Promise<void>
    flush?(): Promise<void>
    cancel?(): void
    write(data: string): void
    readonly writable: boolean
    kill(signal?: NodeJS.Signals): void
}

export function spawnDotoolSink(): DotoolSink {
    if (usesX11Typing()) return new X11TypingSink()
    const dotool: ChildProcessWithoutNullStreams = spawn("dotool", [], {
        env: { ...process.env, DOTOOL_XKB_LAYOUT: "us" },
    })

    dotool.stderr.on("data", (data) => {
        const lines = data.toString().split("\n").filter(Boolean)
        for (const line of lines) {
            log("DOTOOL", line)
        }
    })
    dotool.on("exit", (_code, signal) => {
        log("DOTOOL", `dotool finished with signal [${signal}]`)
    })

    return {
        write(data: string) {
            dotool.stdin.write(data)
        },
        get writable() {
            return dotool.stdin.writable
        },
        kill(signal: NodeJS.Signals = "SIGTERM") {
            dotool.kill(signal)
        },
    }
}

export function usesX11Typing(): boolean {
    return Boolean(process.env.DISPLAY && process.env.XDG_SESSION_TYPE !== "wayland")
}
