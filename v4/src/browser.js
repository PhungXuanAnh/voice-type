// Injected into Chrome via page.evaluate — no imports. Helpers used by evaluated
// functions must be nested inside them (Puppeteer only serializes the top-level export).
// Event mapper: keep browserRecognition.js in sync (tests/browserRecognition.sync.test.ts).

export function initWSA(stream, lang) {
    function recognitionResultsToEvents(stream, resultIndex, results) {
        let interimText = ""
        let finalizedText = ""
        let segmentFinalized = false

        for (let i = resultIndex; i < results.length; i++) {
            if (!results[i].isFinal) {
                interimText += results[i][0].transcript
            } else {
                finalizedText += results[i][0].transcript
                segmentFinalized = true
            }
        }

        const events = []

        if (stream) {
            if (segmentFinalized) {
                if (finalizedText) {
                    events.push({ kind: "text", text: finalizedText })
                }
                events.push({ kind: "segment-finalized" })
            }
            if (interimText) {
                events.push({ kind: "text", text: interimText })
            }
        } else if (segmentFinalized) {
            if (finalizedText) {
                events.push({ kind: "text", text: finalizedText })
            }
            events.push({ kind: "segment-finalized" })
        }

        return events
    }

    console.log("browser connected. initializing Web Speech API...")

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRec) {
        console.error("FATAL: Web Speech API is not supported in this browser context.")
        throw new Error("FATAL: Web Speech API is not supported in this browser context.")
    }

    const rec = new SpeechRec()
    rec.continuous = true
    if (stream) {
        rec.interimResults = true
    }
    rec.lang = lang !== undefined ? lang : "en-US"

    let microphoneStream
    let startGeneration = 0
    window.releaseMicrophone = () => {
        startGeneration++
        microphoneStream?.getTracks().forEach((track) => track.stop())
        microphoneStream = undefined
    }
    window.startWithMicrophone = async () => {
        const generation = ++startGeneration
        // Chrome fires no devicechange for PulseAudio sources created after it started.
        if (window.selectedMicrophone === undefined) await window.loadMicrophones?.()
        if (generation !== startGeneration) return
        const deviceId = window.selectedMicrophone || ""
        if (!deviceId) {
            rec.start()
            return
        }
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { deviceId: { exact: deviceId } },
        })
        if (generation !== startGeneration) {
            stream.getTracks().forEach((track) => track.stop())
            return
        }
        microphoneStream = stream
        try {
            rec.start(stream.getAudioTracks()[0])
        } catch (error) {
            window.releaseMicrophone()
            throw error
        }
    }

    rec.onstart = () => {
        console.log("Listening...")
        rec.isRunning = true
        window.onRecordingState?.(true)
        window.showSpeechStatus?.("Đang nghe", rec.lang)
    }

    rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
            window.showTranscript?.(event.results[i][0].transcript, event.results[i].isFinal)
        }
        const events = recognitionResultsToEvents(stream, event.resultIndex, event.results)
        for (const speechEvent of events) {
            window.onSpeechEvent(speechEvent)
        }
    }

    rec.onerror = (event) => {
        window.releaseMicrophone()
        rec.isRunning = false
        window.onRecordingState?.(false)
        if (event.error === "network") window.isOffline = true
        console.error(`Recognition error: ${event.error}`)
        window.showSpeechStatus?.("Lỗi: " + event.error)
        window.onBrowserError?.(event.error)
    }

    rec.onend = () => {
        window.releaseMicrophone()
        window.onRecordingState?.(false)
        window.onBrowserRecStop({ reason: window.isOffline ? "offline" : "silence" })
        rec.isRunning = false
        window.showSpeechStatus?.("Đã dừng")
        window.isOffline = undefined
    }

    window.recognition = rec
}

export async function startListening() {
    if (!window.recognition) {
        const message = "rec not initialized"
        console.error(message)
        return
    }
    try {
        await window.startWithMicrophone()
    } catch (e) {
        const message = `Error starting rec: ${e.message || e}`
        console.error(message)
    }
}

export async function setLangAndStart(lang) {
    if (!window.recognition) {
        console.error("rec not initialized")
        return
    }
    try {
        window.recognition.lang = lang
        await window.startWithMicrophone()
    } catch (e) {
        window.onRecordingState?.(false)
        window.onBrowserError?.(String(e.message || e))
        console.error(`Error setting lang and starting rec: ${e.message || e}`)
    }
}

export function stopRecognition() {
    window.releaseMicrophone?.()
    if (!window.recognition) {
        const message = "rec not initialized"
        console.error(message)
        return
    }

    try {
        window.recognition.stop()
    } catch (e) {
        const message = `Error stopping rec: ${e.message || JSON.stringify(e)}`
        console.error(message)
    }
}

export function healthCheck() {
    return "ok"
}
