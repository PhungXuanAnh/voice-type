import type { DotoolKeyChord } from "./transcriptTransformers/types.js"
import type { DotoolSink } from "./dotoolSink.js"
import { spawnDotoolSink } from "./dotoolSink.js"
import { log } from "./logger.js"

export default class TypingController {
    private prevText: string = ""
    private dotool: DotoolSink
    public hasStopped = false

    constructor(sink?: DotoolSink) {
        this.dotool = sink ?? spawnDotoolSink()
    }

    public sendBackspaces(count: number) {
        if (count <= 0) return
        if (!this.dotool.writable) {
            log("TYPING", "dotool stdin not writable")
            return
        }
        const cmdString = "key BackSpace \n".repeat(count)
        this.dotool.write(cmdString)
    }

    public sendKeyChord(chord: DotoolKeyChord) {
        if (this.hasStopped) return
        if (!this.dotool.writable) {
            log("TYPING", "dotool stdin not writable")
            return
        }
        this.dotool.write(`key ${chord}\n`)
    }

    public typeText(text: string) {
        if (this.hasStopped) return
        if (!text) return
        if (!this.dotool.writable) {
            log("TYPING", "dotool stdin not writable")
            return
        }

        this.dotool.write(`type ${inlineText(text)}\n`)
    }

    public ready() {
        return this.dotool.ready ?? Promise.resolve()
    }
    public flush() {
        return this.dotool.flush?.() ?? Promise.resolve()
    }

    public applyLiveText(currText: string) {
        if (this.hasStopped) return
        currText = inlineText(currText)
        if (currText === this.prevText) return

        if (this.prevText === "") {
            this.typeText(currText)
        } else {
            const commonPrefixLen = findCommonPrefixLen(currText, this.prevText)
            const charsToDelete = Array.from(this.prevText.slice(commonPrefixLen)).length
            const charsToAdd = currText.slice(commonPrefixLen)
            this.sendBackspaces(charsToDelete)
            this.typeText(charsToAdd)
        }
        this.prevText = currText
    }

    public finalizeSegment() {
        this.prevText = ""
    }

    public reset() {
        this.dotool.cancel?.()
        this.prevText = ""
    }

    public destroy() {
        this.dotool.kill("SIGTERM")
    }
}

function findCommonPrefixLen(currText: string, prevText: string) {
    const current = Array.from(currText)
    const previous = Array.from(prevText)
    let i = 0
    while (i < current.length && i < previous.length && current[i] === previous[i]) i++
    return current.slice(0, i).join("").length
}

// Recognition text is prose. Never turn its controls into submit/navigation keys.
function inlineText(text: string) {
    return text.normalize("NFC").replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
}
