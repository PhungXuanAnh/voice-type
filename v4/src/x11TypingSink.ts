import { execFileSync } from "node:child_process"
import x11 from "x11"
import type { DotoolSink } from "./dotoolSink.js"
import { log } from "./logger.js"

/** Paste UTF-8 through X selections, bypassing application-specific Unicode entry and IMEs. */
export class X11TypingSink implements DotoolSink {
    private client: any
    private window = 0
    private atoms: Record<string, number> = {}
    private text = ""
    private alive = true
    private closed = false
    private generation = 0
    private tail: Promise<void> = Promise.resolve()
    private delivered: (() => void) | undefined
    readonly ready: Promise<void>

    constructor() {
        this.ready = new Promise((resolve, reject) => {
            try {
                execFileSync("xdotool", ["version"], { stdio: "ignore" })
            } catch {
                reject(new Error("X11 typing requires xdotool. Install it with: sudo apt install xdotool"))
                return
            }
            x11.createClient({ disableBigRequests: true }, (error: Error | null, display: any) => {
                if (error) {
                    reject(error)
                    return
                }
                const X = (this.client = display.client)
                X.on("error", (error: Error) => {
                    this.alive = false
                    reject(error)
                    log("TYPING", error)
                })
                if (this.closed) {
                    X.close()
                    reject(new Error("Typing backend closed"))
                    return
                }
                X.on("event", (event: any) => this.selectionRequest(event))
                this.window = X.AllocID()
                X.CreateWindow(this.window, display.screen[0].root, 0, 0, 1, 1, 0, 0, 0, 0, {})
                const names = ["CLIPBOARD", "PRIMARY", "UTF8_STRING", "TEXT", "STRING", "TARGETS", "ATOM"]
                let remaining = names.length
                for (const name of names)
                    X.InternAtom(false, name, (error: Error | null, atom: number) => {
                        if (error) {
                            reject(error)
                            return
                        }
                        this.atoms[name] = atom
                        if (--remaining === 0) resolve()
                    })
            })
        })
        // Startup awaits ready; this also prevents an unhandled rejection during preflight.
        void this.ready.catch((error) => {
            this.alive = false
            log("TYPING", error)
        })
    }

    get writable() {
        return this.alive
    }

    write(script: string) {
        const generation = this.generation
        this.tail = this.tail
            .then(async () => {
                await this.ready
                const lines = script.split("\n")
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i]
                    if (!this.alive || generation !== this.generation) return
                    if (line.startsWith("type ")) await this.paste(line.slice(5))
                    else if (line.startsWith("key ")) {
                        const keys = [line.slice(4).trim().replace(/enter/gi, "Return")]
                        while (lines[i + 1]?.startsWith("key "))
                            keys.push(lines[++i].slice(4).trim().replace(/enter/gi, "Return"))
                        execFileSync("xdotool", ["key", "--clearmodifiers", "--delay", "1", ...keys], {
                            stdio: "ignore",
                        })
                    }
                }
            })
            .catch((error) => {
                this.generation++
                log("TYPING", error)
            })
    }

    flush() {
        return this.tail
    }
    cancel() {
        this.generation++
    }

    private selectionRequest(event: any) {
        if (!this.alive || event.name !== "SelectionRequest") return
        const X = this.client
        const property = event.property || event.target
        let accepted = true
        if (event.target === this.atoms.TARGETS) {
            const targets = Buffer.alloc(16)
            ;["TARGETS", "UTF8_STRING", "TEXT", "STRING"].forEach((name, i) =>
                targets.writeUInt32LE(this.atoms[name], i * 4),
            )
            X.ChangeProperty(0, event.requestor, property, this.atoms.ATOM, 32, targets)
        } else if ([this.atoms.UTF8_STRING, this.atoms.TEXT, this.atoms.STRING].includes(event.target)) {
            X.ChangeProperty(0, event.requestor, property, this.atoms.UTF8_STRING, 8, Buffer.from(this.text))
        } else accepted = false
        const reply = Buffer.alloc(32)
        reply[0] = 31 // SelectionNotify
        ;[event.time, event.requestor, event.selection, event.target, accepted ? property : 0].forEach((value, i) =>
            reply.writeUInt32LE(value >>> 0, 4 + i * 4),
        )
        X.SendEvent(event.requestor, false, 0, reply)
        if (accepted && event.target !== this.atoms.TARGETS) {
            // Confirm the server queued SelectionNotify before sending the next editing keys.
            X.GetInputFocus(() => this.delivered?.())
        }
    }

    private async paste(text: string) {
        this.text = text
        const X = this.client
        X.SetSelectionOwner(this.window, this.atoms.CLIPBOARD, 0)
        X.SetSelectionOwner(this.window, this.atoms.PRIMARY, 0)
        await new Promise<void>((resolve, reject) =>
            X.GetSelectionOwner(this.atoms.CLIPBOARD, (error: Error | null) => (error ? reject(error) : resolve())),
        )
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.delivered = undefined
                reject(new Error("The focused application did not accept pasted text."))
            }, 2000)
            this.delivered = () => {
                clearTimeout(timer)
                this.delivered = undefined
                resolve()
            }
            try {
                execFileSync("xdotool", ["key", "--clearmodifiers", "shift+Insert"], { stdio: "ignore" })
            } catch (error) {
                clearTimeout(timer)
                this.delivered = undefined
                reject(error)
            }
        })
    }

    kill() {
        if (this.closed) return
        this.closed = true
        this.cancel()
        this.alive = false
        this.delivered?.()
        this.client?.close()
    }
}
