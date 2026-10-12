const ovOrb = document.getElementById('ovOrb');
const ovStatus = document.getElementById('ovStatus');
const ovClose = document.getElementById('ovClose');
const ovPeek = document.getElementById('ovPeek');
const ovPeekPanel = document.getElementById('ovPeekPanel');
const ovChartBox = document.getElementById('ovChartBox');
const ovChart = document.getElementById('ovChart');

// ---------- behind-the-scenes log: every real step of a turn gets pushed here, so tapping
// the small arrow shows what Nova is actually doing (STT -> API call -> action), not a fake log ----------
function logStep(text) {
  const row = document.createElement('div');
  row.className = 'step';
  row.textContent = text;
  ovPeekPanel.appendChild(row);
  ovPeekPanel.scrollTop = ovPeekPanel.scrollHeight;
}
function clearLog() { ovPeekPanel.innerHTML = ''; }
ovPeek.addEventListener('click', () => ovPeekPanel.classList.toggle('open'));

// ---------- mini chart drawn in the corner when the answer contains a ```chart block ----------
function drawMiniChart(spec) {
  const ctx = ovChart.getContext('2d');
  const W = ovChart.width, H = ovChart.height, pad = 18;
  const values = (spec.values || []).map(Number);
  const max = Math.max(1, ...values);
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#E4DECF'; ctx.beginPath();
  ctx.moveTo(pad, H - pad); ctx.lineTo(W - 4, H - pad); ctx.stroke();
  ctx.fillStyle = '#8A8371'; ctx.font = '8px sans-serif'; ctx.textAlign = 'right';
  ctx.fillText(String(max), pad - 3, 10);
  ctx.fillText('0', pad - 3, H - pad + 3);
  const bw = (W - pad - 4) / Math.max(1, values.length);
  values.forEach((v, i) => {
    const h = (v / max) * (H - pad - 10);
    ctx.fillStyle = '#C2611A';
    ctx.fillRect(pad + i * bw + 2, H - pad - h, bw - 4, h);
    ctx.fillStyle = '#4A3A2A'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(v)), pad + i * bw + bw / 2, H - pad - h - 3);
  });
  ovChartBox.classList.add('open');
}

let busy = false;              // mirrors Wake.busy in the Android app
let assistantName = 'نوا';
let wakeHandle = null;         // { stop() } from STT.startWakeLoop, when using Whisper
let legacyWakeOn = false;      // when falling back to the browser's own (unreliable) recognizer
let legacyRecognizer = null;
const BCP = { en: 'en-US', fa: 'fa-IR', ar: 'ar-SA', ru: 'ru-RU' };
let uiLang = 'en';
let legacyLang = 'en-US';
const T = (k) => window.I18N.t(k);
async function refreshLang() {
  uiLang = await window.nova.store.get('uiLang', 'en');
  window.I18N.apply(uiLang);
}
let legacyNetworkErrors = 0;
let warnedAboutSpeechLimit = false;

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const synth = window.speechSynthesis;

function setStatus(text, listening) {
  ovStatus.textContent = text;
  ovOrb.classList.toggle('listening', !!listening);
}

function speak(text, lang, onDone) {
  if (!synth || !text) { onDone && onDone(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = BCP[lang] || 'en-US';
  u.onend = () => onDone && onDone();
  u.onerror = () => onDone && onDone();
  synth.cancel();
  synth.speak(u);
}

// ========== PRIMARY PATH: real speech-to-text (Whisper via the main process) ==========
// Needs a free Groq key pasted into Settings -> "Speech recognition key". Local voice-activity
// detection (window.STT) means no audio is sent anywhere while the room is quiet -- only the
// burst of speech that was actually said gets uploaded and transcribed.
async function startWhisperWakeLoop() {
  setStatus(T('ov_listening'), false);
  wakeHandle = await window.STT.startWakeLoop({
    lang: '',
    onHeard: (text) => {
      if (busy) return;
      if (window.Wake.matches(text, assistantName)) { onWakeDetected(); return; }
      // not the wake word -- treat it as background noise/conversation and keep listening quietly
    },
    onError: (err) => {
      setStatus(T('ov_mic_error') + (err && err.message || err), false);
    },
  });
}
function stopWhisperWakeLoop() {
  if (wakeHandle) { wakeHandle.stop(); wakeHandle = null; }
}

// ========== FALLBACK PATH: Chromium's built-in recognizer ==========
// Used only when no STT key is configured yet, so the app still does *something* out of the
// box. It relies on a Google-owned speech backend that Electron's bundled Chromium usually
// cannot reach, so expect it to be unreliable -- the Settings hint explains this and points at
// the Whisper path above.
function startLegacyWakeLoop() {
  if (!SpeechRecognitionCtor) {
    setStatus(T('ov_no_engine'), false);
    return;
  }
  legacyWakeOn = true;
  restartLegacyRecognizer();
}
function stopLegacyWakeLoop() {
  legacyWakeOn = false;
  if (legacyRecognizer) { try { legacyRecognizer.abort(); } catch {} legacyRecognizer = null; }
}
function restartLegacyRecognizer() {
  if (!legacyWakeOn || busy) return;
  if (legacyRecognizer) { try { legacyRecognizer.abort(); } catch {} }
  legacyRecognizer = new SpeechRecognitionCtor();
  legacyLang = legacyLang === 'en-US' ? (BCP[uiLang] || 'en-US') : 'en-US';
  legacyRecognizer.lang = legacyLang;
  legacyRecognizer.continuous = true;
  legacyRecognizer.interimResults = true;
  legacyRecognizer.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript;
      if (window.Wake.matches(text, assistantName)) {
        stopLegacyWakeLoop();
        onWakeDetected();
        return;
      }
    }
  };
  legacyRecognizer.onerror = (e) => {
    if (!legacyWakeOn) return;
    if (e.error === 'no-speech' || e.error === 'aborted') { setTimeout(restartLegacyRecognizer, 120); return; }
    if (e.error === 'not-allowed') { setStatus(T('ov_mic_denied'), false); legacyWakeOn = false; return; }
    if (e.error === 'network') {
      legacyNetworkErrors++;
      if (legacyNetworkErrors >= 5) {
        if (!warnedAboutSpeechLimit) {
          warnedAboutSpeechLimit = true;
          setStatus(T('ov_browser_stt_broken'), false);
        }
        setTimeout(restartLegacyRecognizer, 15000);
        return;
      }
    }
    setTimeout(restartLegacyRecognizer, 800);
  };
  legacyRecognizer.onend = () => { if (legacyWakeOn) setTimeout(restartLegacyRecognizer, 100); };
  try { legacyRecognizer.start(); legacyNetworkErrors = 0; } catch { setTimeout(restartLegacyRecognizer, 500); }
}

// ========== shared entry points ==========
async function startWakeLoop() {
  if (await window.STT.sttKeyConfigured()) await startWhisperWakeLoop();
  else startLegacyWakeLoop();
}
function stopWakeLoop() {
  stopWhisperWakeLoop();
  stopLegacyWakeLoop();
}

// ---------- the actual conversation turn, after the name was heard ----------
async function onWakeDetected() {
  busy = true;
  clearLog(); ovChartBox.classList.remove('open');
  logStep('شنیدن اسم نوا');
  stopLegacyWakeLoop(); // whisper loop pauses itself naturally (listenForCommand reuses the same mic graph)
  await window.nova.overlay.show();
  await refreshLang();
  const lang = uiLang;
  const hello = T('ov_yes');
  setStatus(hello, false);
  speak(hello, lang, () => listenForCommand(lang));
  setTimeout(() => listenForCommand(lang), 2500); // safety net if TTS's onend never fires
}

let commandStarted = false;
async function listenForCommand(lang) {
  if (commandStarted) return;
  commandStarted = true;
  setStatus(T('ov_listening'), true);
  logStep('گوش دادن به دستور');
  try {
    let text = '';
    const offlineDictate = await window.nova.store.get('offlineDictate', false);
    const useWhisper = (await window.STT.sttKeyConfigured()) && (navigator.onLine || !offlineDictate);
    if (useWhisper) {
      text = await window.STT.listenOnce({
        lang: '', // auto-detect: the person may speak a different language than the UI
        onThinking: () => { setStatus(T('ov_thinking'), false); logStep('تبدیل صدا به متن'); },
      });
    } else if (SpeechRecognitionCtor) {
      text = await legacyListenOnce(lang);
    }
    if (!text) { finishTurn(); return; }
    await handleCommand(text, lang);
  } catch (err) {
    setStatus(T('error_prefix') + (err.message || err), false);
    setTimeout(finishTurn, 1800);
  }
}
function legacyListenOnce(lang) {
  return new Promise((resolve) => {
    const r = new SpeechRecognitionCtor();
    r.lang = BCP[lang] || 'en-US';
    r.continuous = false; r.interimResults = true;
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (last.isFinal) resolve(last[0].transcript);
      else setStatus(last[0].transcript, true);
    };
    r.onerror = () => resolve('');
    try { r.start(); } catch { resolve(''); }
  });
}

async function handleCommand(text, lang) {
  setStatus(text, false);
  logStep('فهمیدن منظور: «' + text + '»');
  try {
    ovOrb.classList.add('thinking');
    const history = await window.nova.store.get('liveMessages', []);
    logStep('در حال فکر کردن...');
    const answer = await window.ChatCore.ask(text, history);
    ovOrb.classList.remove('thinking');
    const chart = window.Artifact.extractChart(answer);
    if (chart) { logStep('رسم نمودار'); drawMiniChart(chart); }
    const act = window.Actions.parseAndStrip(window.Artifact.stripChart(answer));
    let finalText = act.clean || answer;
    if (act.name) {
      logStep('اجرای عملیات: ' + act.name);
      const r = await window.Actions.run(act.name, act.arg);
      finalText = (finalText ? finalText + ' ' : '') + (r && r.ok ? T('ov_done') : T('ov_failed'));
    }
    await window.ChatCore.appendHistory('user', text);
    await window.ChatCore.appendHistory('assistant', finalText);
    setStatus(finalText, false);
    speak(finalText, lang, finishTurn);
  } catch (err) {
    ovOrb.classList.remove('thinking');
    setStatus(T('error_prefix') + (err.message || err), false);
    setTimeout(finishTurn, 1800);
  }
}

function finishTurn() {
  commandStarted = false;
  busy = false;
  // window.nova.overlay.show() left it visible with a close button -- resume the wake loop quietly.
  setTimeout(async () => {
    if (await window.STT.sttKeyConfigured()) { if (!wakeHandle) await startWhisperWakeLoop(); }
    else if (legacyWakeOn) restartLegacyRecognizer();
  }, 400);
}

// ---------- UI wiring ----------
// tap the orb itself to talk, same as saying the wake word (mirrors tapping the Siri bubble)
ovOrb.addEventListener('click', () => {
  if (busy) return;
  window.nova.overlay.show();
  onWakeDetected();
});
ovClose.addEventListener('click', () => {
  synth && synth.cancel();
  window.nova.overlay.hide();
});

// 100%-reliable manual trigger (Ctrl+Shift+J), in case the wake word itself gets missed
window.nova.on('wake:trigger', () => { if (!busy) { window.nova.overlay.show(); onWakeDetected(); } });

window.nova.on('wake:start', async () => {
  assistantName = await window.nova.store.get('assistantName', 'نوا');
  await refreshLang();
  await startWakeLoop();
});
window.nova.on('wake:stop', () => { stopWakeLoop(); window.nova.overlay.hide(); });

refreshLang().then(() => setStatus(T('ov_ready'), false));
