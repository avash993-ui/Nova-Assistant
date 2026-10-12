// Shared speech-to-text helper, used by both wake.js (background wake-word listening) and
// renderer.js (the push-to-talk mic button). Replaces Chromium's built-in SpeechRecognition,
// which needs a Google-owned API key that Electron doesn't ship with and so fails constantly.
//
// Strategy:
//  - Keep ONE microphone stream + ONE AnalyserNode open and do local volume (RMS) checks for
//    free, with no network calls, to detect "someone started/stopped talking".
//  - Only record and upload a clip to Whisper (via the main process) when real speech is
//    actually happening, and stop the clip automatically once the person goes quiet again
//    (silence detection) instead of always recording a fixed number of seconds.
//  - This keeps it both responsive (no fixed polling delay) and cheap (no audio is sent to
//    the API during silence).
window.STT = (function () {
  let sharedStream = null;
  let sharedCtx = null;
  let sharedAnalyser = null;

  async function ensureAudioGraph() {
    if (!sharedStream) sharedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!sharedCtx) {
      sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (sharedCtx.state === 'suspended') { try { await sharedCtx.resume(); } catch {} }
      const src = sharedCtx.createMediaStreamSource(sharedStream);
      sharedAnalyser = sharedCtx.createAnalyser();
      sharedAnalyser.fftSize = 2048;
      src.connect(sharedAnalyser);
    }
    return { stream: sharedStream, analyser: sharedAnalyser };
  }

  function rms(analyser) {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  }

  function pickMime() {
    return MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  }

  // Records starting now, and stops automatically once the mic has been quiet for `silenceMs`
  // (after at least `minMs` has elapsed), or after `maxMs` no matter what. Used both to capture
  // a spoken command and, in the wake loop, to capture one "burst" of speech to check for the
  // wake word.
  function recordUntilSilence(stream, analyser, { minMs = 500, silenceMs = 700, maxMs = 8000, threshold = 0.012 } = {}) {
    const mime = pickMime();
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    return new Promise((resolve) => {
      // wall-clock based on purpose: timers can fire late (hidden windows, busy CPU), so counting ticks drifts
      const t0 = performance.now();
      let lastLoud = t0;
      rec.start();
      const timer = setInterval(() => {
        const now = performance.now();
        const elapsed = now - t0;
        if (rms(analyser) >= threshold) lastLoud = now;
        const silentFor = now - lastLoud;
        if (elapsed >= maxMs || (elapsed >= minMs && silentFor >= silenceMs)) {
          clearInterval(timer);
          rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
          rec.stop();
        }
      }, 100);
    });
  }

  // Watches the mic locally (no network) until speech begins (RMS above threshold for a short
  // sustained stretch, so a cough or a click doesn't count), then returns.
  function waitForSpeechOnset(analyser, { threshold = 0.02, sustainMs = 120, pollMs = 60, signal } = {}) {
    return new Promise((resolve, reject) => {
      let aboveSince = 0;
      const timer = setInterval(() => {
        if (signal && signal.aborted) { clearInterval(timer); reject(new Error('aborted')); return; }
        const now = performance.now();
        if (rms(analyser) >= threshold) { if (!aboveSince) aboveSince = now; } else aboveSince = 0;
        if (aboveSince && now - aboveSince >= sustainMs) { clearInterval(timer); resolve(); }
      }, pollMs);
      if (signal) signal.addEventListener('abort', () => { clearInterval(timer); reject(new Error('aborted')); });
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function sttKeyConfigured() {
    const key = await window.nova.store.get('sttKey', '');
    return !!key;
  }

  async function transcribeBlob(blob, lang) {
    const key = await window.nova.store.get('sttKey', '');
    if (!key) throw new Error('no-stt-key');
    const base64 = await blobToBase64(blob);
    return window.nova.api.transcribe({ key, base64, mime: blob.type, lang: lang || '' });
  }

  // One push-to-talk turn: wait (briefly) for you to start talking, record until you stop, transcribe.
  async function listenOnce({ lang, onListening, onThinking, maxWaitMs = 6000 } = {}) {
    const { stream, analyser } = await ensureAudioGraph();
    onListening && onListening();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), maxWaitMs);
    try {
      await waitForSpeechOnset(analyser, { signal: controller.signal });
    } catch {
      clearTimeout(timeout);
      return '';
    }
    clearTimeout(timeout);
    const blob = await recordUntilSilence(stream, analyser, {});
    onThinking && onThinking();
    return transcribeBlob(blob, lang);
  }

  // Background wake-word loop: cheap local VAD while idle (no API calls at all), and only
  // transcribes the one burst of speech that triggered it. Calls onHeard(transcript) for every
  // burst; the caller (wake.js) decides whether it matched the wake word.
  async function startWakeLoop({ onHeard, onError, lang }) {
    const { stream, analyser } = await ensureAudioGraph();
    let running = true;
    (async function loop() {
      while (running) {
        try {
          await waitForSpeechOnset(analyser, {});
          if (!running) break;
          const blob = await recordUntilSilence(stream, analyser, { maxMs: 4000, silenceMs: 500 });
          if (!running) break;
          const text = await transcribeBlob(blob, lang);
          if (text) onHeard && onHeard(text);
        } catch (err) {
          onError && onError(err);
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    })();
    return { stop: () => { running = false; } };
  }

  return { sttKeyConfigured, transcribeBlob, listenOnce, startWakeLoop, ensureAudioGraph };
})();
