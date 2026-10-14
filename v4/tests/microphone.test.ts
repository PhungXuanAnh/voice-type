import { expect, test, mock } from "bun:test"
import { runInNewContext } from "node:vm"
import { initWSA, setLangAndStart, stopRecognition } from "../src/browser.js"

const track = { stop: mock() }
const stream = { getTracks: () => [track], getAudioTracks: () => [track] }
function setup(getUserMedia = mock(async (_constraints: unknown) => stream)) {
    const window: any = {
        SpeechRecognition: class {
            start = mock()
            stop = mock()
        },
        selectedMicrophone: "usb-mic",
        onBrowserError: mock(),
        onBrowserRecStop: mock(),
    }
    const context = { window, navigator: { mediaDevices: { getUserMedia } }, console }
    runInNewContext(`(${initWSA})(false, "vi-VN")`, context)
    return {
        window,
        getUserMedia,
        start: () => runInNewContext(`(${setLangAndStart})("vi-VN")`, context),
        stop: () => runInNewContext(`(${stopRecognition})()`, context),
    }
}

test("selected microphone feeds recognition and is released on stop/end/error", async () => {
    const app = setup()
    for (const end of [
        () => app.stop(),
        () => app.window.recognition.onend(),
        () => app.window.recognition.onerror({ error: "network" }),
    ]) {
        track.stop.mockClear()
        await app.start()
        expect(app.getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: "usb-mic" } } })
        expect(app.window.recognition.start).toHaveBeenLastCalledWith(track)
        end()
        expect(track.stop).toHaveBeenCalledTimes(1)
    }
    app.window.selectedMicrophone = ""
    await app.start()
    expect(app.window.recognition.start).toHaveBeenLastCalledWith()
})

test("stopping during capture prevents recognition; device errors reach daemon", async () => {
    let resolve!: (value: typeof stream) => void
    const app = setup(
        mock(
            () =>
                new Promise<typeof stream>((done) => {
                    resolve = done
                }),
        ),
    )
    track.stop.mockClear()
    const starting = app.start()
    app.stop()
    resolve(stream)
    await starting
    expect(app.window.recognition.start).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledTimes(1)
    const failed = setup(
        mock(async () => {
            throw new Error("Micro disconnected")
        }),
    )
    await failed.start()
    expect(failed.window.onBrowserError).toHaveBeenCalledWith("Micro disconnected")
    expect(failed.window.recognition.start).not.toHaveBeenCalled()
})
