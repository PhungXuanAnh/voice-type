import { describe, expect, test } from "bun:test"
import TypingController from "../src/typingController.js"
import { CapturingSink } from "./helpers.js"

describe("TypingController", () => {
    test("types full text when prevText is empty", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.applyLiveText("hello")
        expect(sink.writes.join("")).toContain("type hello\n")
    })

    test("prefix diff appends suffix", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.applyLiveText("he")
        tc.applyLiveText("hello")
        const script = sink.writes.join("")
        expect(script).toContain("type he\n")
        expect(script).toContain("type llo\n")
        expect(script).not.toContain("BackSpace")
    })

    test("prefix diff backspaces changed suffix", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.applyLiveText("hello")
        tc.applyLiveText("help")
        const script = sink.writes.join("")
        expect(script).toContain("key BackSpace")
        expect(script).toContain("type p\n")
    })

    test("no-op when text unchanged", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.applyLiveText("hello")
        const count = sink.writes.length
        tc.applyLiveText("hello")
        expect(sink.writes.length).toBe(count)
    })

    test("sendBackspaces emits BackSpace keys", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.sendBackspaces(2)
        expect(sink.writes.join("")).toBe("key BackSpace \nkey BackSpace \n")
    })

    test("Unicode is passed as text without compose shortcuts or Enter", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.typeText("bây giờ tôi dùng tiếng Việt")
        expect(sink.writes).toEqual(["type bây giờ tôi dùng tiếng Việt\n"])
    })

    test("live corrections normalize accents and delete code points rather than UTF-16 halves", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.applyLiveText("a\u0302😀")
        tc.applyLiveText("âđ")
        expect(sink.writes).toEqual(["type â😀\n", "key BackSpace \n", "type đ\n"])
    })

    test("recognition line breaks and controls remain inline and never become commands", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.applyLiveText("tôi\r\nkey enter\tđang\u2028nói\x1b")
        tc.finalizeSegment()
        tc.reset()
        expect(sink.writes).toEqual(["type tôi key enter đang nói \n"])
    })

    test("sendKeyChord", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.sendKeyChord("ctrl+enter")
        expect(sink.writes.join("")).toBe("key ctrl+enter\n")
    })

    test("hasStopped blocks typing and chords", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.hasStopped = true
        tc.applyLiveText("hello")
        tc.sendKeyChord("ctrl+enter")
        expect(sink.writes).toHaveLength(0)
    })

    test("finalizeSegment clears prevText for next apply", () => {
        const sink = new CapturingSink()
        const tc = new TypingController(sink)
        tc.applyLiveText("hello")
        tc.finalizeSegment()
        tc.applyLiveText("world")
        const script = sink.writes.join("")
        expect(script).toContain("type hello\n")
        expect(script).toContain("type world\n")
        expect(script).not.toContain("BackSpace")
    })
})
