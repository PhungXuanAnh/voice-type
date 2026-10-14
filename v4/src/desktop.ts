import { createHash } from "node:crypto"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, writeFile, rm, access } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import nativeSource from "./native/chrome-tray.c" with { type: "text" }
import traySource from "./native/tray.py" with { type: "text" }
import { log } from "./logger.js"

export interface DesktopSession {
    env: NodeJS.ProcessEnv
    profile: string
    restore(pid: number): void
    close(): Promise<void>
}

export async function prepareDesktop(onAction: (action: string) => void): Promise<DesktopSession> {
    if (!process.env.DISPLAY) throw new Error("Desktop mode needs an X11 DISPLAY.")
    const root = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "voice-type")
    if (/[:\s]/.test(root)) throw new Error("Desktop cache path must not contain spaces or colons.")
    await mkdir(root, { recursive: true, mode: 0o700 })
    const digest = createHash("sha256").update(nativeSource).digest("hex").slice(0, 16)
    const library = join(root, `chrome-tray-${process.arch}-${digest}.so`)
    const helper = `${library}.restore`
    const source = `${library}.c`
    try {
        await access(library)
        await access(helper)
    } catch {
        await writeFile(source, nativeSource)
        const flags = ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror"]
        try {
            execFileSync("cc", [...flags, "-shared", "-fPIC", source, "-o", library, "-lxcb", "-ldl"])
            execFileSync("cc", [...flags, "-DVOICE_TYPE_HELPER", source, "-o", helper, "-lxcb", "-ldl"])
        } catch (error) {
            throw new Error(`Desktop mode requires cc and libxcb headers (build-essential libxcb1-dev): ${error}`)
        }
    }
    const profile = await mkdtemp(join(root, "chrome-"))
    let tray: ChildProcess | undefined
    let closing = false
    const close = async () => {
        closing = true
        tray?.stdin?.end()
        tray?.kill()
        await rm(profile, { recursive: true, force: true })
    }
    try {
        await mkdir(join(profile, "Default"))
        await writeFile(
            join(profile, "Default", "Preferences"),
            JSON.stringify({ browser: { custom_chrome_frame: false } }),
        )
        tray = spawn("/usr/bin/python3", ["-u", "-c", traySource], { stdio: ["pipe", "pipe", "pipe"] })
        tray.stderr?.on("data", (data) => log("TRAY", data.toString().trim()))
        const lines = createInterface({ input: tray.stdout! })
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("Tray did not start; install python3-gi and gir1.2-ayatanaappindicator3-0.1.")),
                5000,
            )
            const failed = (error: Error) => {
                clearTimeout(timer)
                reject(error)
            }
            tray!.once("error", failed)
            tray!.once("exit", () => failed(new Error("Tray process exited during startup.")))
            lines.on("line", (line) => {
                try {
                    const { action } = JSON.parse(line)
                    if (action === "ready") {
                        clearTimeout(timer)
                        resolve()
                    } else onAction(action)
                } catch (error) {
                    log("TRAY", error)
                }
            })
        })
        tray.on("exit", () => {
            if (!closing) onAction("tray-exited")
        })
        return {
            profile,
            env: { ...process.env, LD_PRELOAD: [library, process.env.LD_PRELOAD].filter(Boolean).join(":") },
            restore(pid) {
                execFileSync(helper, [String(pid)])
            },
            close,
        }
    } catch (error) {
        await close()
        throw error
    }
}
