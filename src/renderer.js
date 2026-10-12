const $ = (id) => document.getElementById(id);

const PROVIDERS = [
  { id: 'llm7', name: 'LLM7', base: 'https://api.llm7.io/v1', models: ['fast', 'default', 'pro'], needsKey: false },
  { id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', models: ['openrouter/auto', 'meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free'] },
  { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'gemini', name: 'Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'] },
  { id: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'] },
  { id: 'ollama', name: '📡 Ollama', base: 'http://localhost:11434/v1', models: [], needsKey: false },
  { id: 'custom', name: '', base: '', models: [] },
];

let state = {
  screen: 'chat',
  convos: [],          // [{id, title, msgs:[{role,text}]}]
  activeConvoId: null,
  provider: PROVIDERS[0],
  pendingFiles: [],
};

// ---------- navigation ----------
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchScreen(btn.dataset.screen));
});
function switchScreen(name) {
  state.screen = name;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.screen === name));
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + name));
  $('topTitle').textContent = {
    chat: window.I18N.t('title_chat'), setup: window.I18N.t('title_setup'), settings: window.I18N.t('title_settings'),
  }[name];
}

// ---------- chat ----------
function activeConvo() { return state.convos.find((c) => c.id === state.activeConvoId); }
function newConvo() {
  const c = { id: Date.now(), title: window.I18N.t('new_chat_title'), msgs: [] };
  state.convos.unshift(c); state.activeConvoId = c.id;
  renderHistory(); renderMessages();
}
function renderHistory() {
  const el = $('historyPanel');
  el.innerHTML = '';
  const newBtn = document.createElement('button');
  newBtn.textContent = window.I18N.t('new_chat'); newBtn.style.color = '#FFB300';
  newBtn.addEventListener('click', newConvo);
  el.appendChild(newBtn);
  state.convos.forEach((c) => {
    const b = document.createElement('button');
    b.textContent = c.title;
    b.className = c.id === state.activeConvoId ? 'active' : '';
    b.addEventListener('click', () => { state.activeConvoId = c.id; renderHistory(); renderMessages(); });
    el.appendChild(b);
  });
}
function renderMessages() {
  const el = $('messages'); el.innerHTML = '';
  const c = activeConvo();
  if (!c) return;
  c.msgs.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant');
    if (m.attachments && m.attachments.length) {
      div.appendChild(buildAttachmentChips(m.attachments));
      if (m.text) div.appendChild(document.createElement('br'));
    }
    if (m.role === 'assistant') {
      const parts = window.Artifact.extract(m.text);
      if (parts.length) { div.appendChild(buildFileCards(parts)); div.appendChild(document.createElement('br')); }
      const chart = window.Artifact.extractChart(m.text);
      if (chart) { div.appendChild(buildChartCard(chart)); div.appendChild(document.createElement('br')); }
      const run = parseRunCommand(m.text);
      if (run) { div.appendChild(buildRunCard(run)); div.appendChild(document.createElement('br')); }
    }
    if (m.role === 'assistant' && m.text === '…') {
      div.className = 'thinking-bubble';
      div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
      el.appendChild(div);
      return;
    }
    const shownText = m.role === 'assistant'
      ? stripRunLine(window.Artifact.stripChart(m.text))
      : m.text;
    if (shownText) div.appendChild(document.createTextNode(shownText));
    el.appendChild(div);
  });
  el.scrollTop = el.scrollHeight;
}

// ---------- attachment chips: shown instead of a raw "فایل‌ها: a.png، b.pdf" text line ----------
function buildAttachmentChips(files) {
  const wrap = document.createElement('div'); wrap.className = 'file-cards';
  files.forEach((f) => {
    const card = document.createElement('div'); card.className = 'file-card attach-chip';
    const icon = document.createElement('span'); icon.className = 'file-icon';
    icon.textContent = ['.png', '.jpg', '.jpeg', '.webp'].includes(f.ext) ? '🖼️' : iconFor(extOf(f.name));
    const name = document.createElement('span'); name.className = 'file-name'; name.textContent = f.name;
    card.appendChild(icon); card.appendChild(name);
    wrap.appendChild(card);
  });
  return wrap;
}

// ---------- inline chart card: renders a ```chart fenced block as a small canvas chart ----------
const CHART_COLORS = ['#C2611A', '#2A7F72', '#3AB8FF', '#C4493A', '#8E6FC7', '#D4A017'];
function buildChartCard(spec) {
  const card = document.createElement('div'); card.className = 'chart-card';
  if (spec.title) {
    const title = document.createElement('div'); title.className = 'chart-title'; title.textContent = spec.title;
    card.appendChild(title);
  }
  const type = (spec.type || 'bar').toLowerCase();
  const canvas = document.createElement('canvas');
  canvas.width = 420; canvas.height = type === 'pie' ? 230 : 240;
  card.appendChild(canvas);
  drawChart(canvas, spec);
  const legend = document.createElement('div'); legend.className = 'chart-legend';
  const labels = spec.labels || [];
  const values = (spec.values || []).map(Number);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  labels.forEach((l, i) => {
    const item = document.createElement('span');
    const pct = type === 'pie' ? ` (${Math.round((values[i] / total) * 100)}%)` : '';
    item.innerHTML = `<span class="dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>${String(l)}: ${values[i]}${pct}`;
    legend.appendChild(item);
  });
  card.appendChild(legend);
  return card;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}
function drawChart(canvas, spec) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const labels = spec.labels || [];
  const values = (spec.values || []).map(Number);
  const type = (spec.type || 'bar').toLowerCase();
  ctx.clearRect(0, 0, W, H);

  if (type === 'pie') {
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 14;
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let start = -Math.PI / 2;
    values.forEach((v, i) => {
      const slice = (v / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, start, start + slice); ctx.closePath();
      ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length]; ctx.fill();
      const mid = start + slice / 2;
      ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      if (slice > 0.18) ctx.fillText(Math.round((v / total) * 100) + '%', cx + Math.cos(mid) * r * 0.6, cy + Math.sin(mid) * r * 0.6);
      start += slice;
    });
    return;
  }

  const pad = 34, padR = 10, padT = 16;
  const max = niceMax(Math.max(1, ...values));
  const plotW = W - pad - padR, plotH = H - pad - padT;
  ctx.strokeStyle = '#E4DECF'; ctx.fillStyle = '#8A8371'; ctx.font = '9px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (i / 4) * plotH;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - padR, y); ctx.strokeStyle = i === 0 ? '#B8AE98' : '#EFEADF'; ctx.stroke();
    ctx.fillText(String(Math.round((max * i) / 4)), pad - 5, y + 3);
  }
  if (type === 'line') {
    ctx.strokeStyle = CHART_COLORS[0]; ctx.lineWidth = 2; ctx.beginPath();
    values.forEach((v, i) => {
      const x = pad + (i * plotW) / Math.max(1, values.length - 1);
      const y = padT + plotH - (v / max) * plotH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    values.forEach((v, i) => {
      const x = pad + (i * plotW) / Math.max(1, values.length - 1);
      const y = padT + plotH - (v / max) * plotH;
      ctx.fillStyle = CHART_COLORS[0]; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2B2822'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(v), x, y - 7);
    });
  } else {
    const bw = plotW / Math.max(1, values.length);
    values.forEach((v, i) => {
      const h = (v / max) * plotH;
      const x = pad + i * bw;
      ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
      ctx.fillRect(x + 4, padT + plotH - h, bw - 8, h);
      ctx.fillStyle = '#2B2822'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(String(v), x + bw / 2, padT + plotH - h - 4);
    });
  }
  ctx.fillStyle = '#8A8371'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
  labels.forEach((l, i) => {
    const x = pad + (i + 0.5) * (plotW / Math.max(1, labels.length));
    ctx.fillText(String(l).slice(0, 9), x, padT + plotH + 14);
  });
}

// ---------- file cards: a download button per file, like Claude's file cards ----------
function extOf(name) { const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i + 1).toLowerCase() : ''; }
function iconFor(ext) {
  return { js: '📜', ts: '📜', py: '🐍', json: '🧩', md: '📝', html: '🌐', css: '🎨', kt: '📦', java: '📦', txt: '📄', csv: '📊' }[ext] || '📄';
}
function buildFileCards(parts) {
  const wrap = document.createElement('div'); wrap.className = 'file-cards';
  parts.forEach((p) => {
    const card = document.createElement('div'); card.className = 'file-card';
    const icon = document.createElement('span'); icon.className = 'file-icon'; icon.textContent = iconFor(extOf(p.name));
    const name = document.createElement('span'); name.className = 'file-name'; name.textContent = p.name;
    const dl = document.createElement('button'); dl.className = 'btn file-dl'; dl.textContent = window.I18N.t('download');
    dl.addEventListener('click', () => window.nova.files.saveOne({ suggestedName: p.name, content: p.body }));
    card.appendChild(icon); card.appendChild(name); card.appendChild(dl);
    wrap.appendChild(card);
  });
  if (parts.length > 1) {
    const allBtn = document.createElement('button'); allBtn.className = 'btn gold'; allBtn.style.marginTop = '6px';
    allBtn.textContent = window.I18N.t('download_all');
    allBtn.addEventListener('click', () => window.nova.files.exportZip({ suggestedName: 'nova-project.zip', parts }));
    wrap.appendChild(allBtn);
  }
  return wrap;
}

// ---------- local build/run: only if the user turned it on in Settings, and only after they click "اجرا" ----------
const runLineRe = /^\s*RUN:\s*(.+)$/im;
function parseRunCommand(text) { const m = runLineRe.exec(text); return m ? m[1].trim() : null; }
function stripRunLine(text) { return text.replace(runLineRe, '').trim(); }
function buildRunCard(command) {
  const card = document.createElement('div'); card.className = 'run-card';
  const label = document.createElement('div'); label.className = 'run-label'; label.textContent = window.I18N.t('run_suggest');
  const code = document.createElement('code'); code.className = 'run-cmd'; code.textContent = command;
  const out = document.createElement('pre'); out.className = 'run-out'; out.style.display = 'none';
  const row = document.createElement('div'); row.className = 'row';
  const runBtn = document.createElement('button'); runBtn.className = 'btn gold'; runBtn.textContent = window.I18N.t('run_btn');
  const cancelBtn = document.createElement('button'); cancelBtn.className = 'btn'; cancelBtn.textContent = window.I18N.t('run_cancel');
  row.appendChild(runBtn); row.appendChild(cancelBtn);
  card.appendChild(label); card.appendChild(code); card.appendChild(row); card.appendChild(out);
  cancelBtn.addEventListener('click', () => { row.remove(); label.textContent = window.I18N.t('run_not_executed'); });
  runBtn.addEventListener('click', async () => {
    runBtn.disabled = true; runBtn.textContent = window.I18N.t('run_running');
    const cwd = await window.nova.store.get('buildFolder', '');
    const r = await window.nova.exec.run({ command, cwd });
    out.style.display = 'block';
    out.textContent = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '') || (r.ok ? window.I18N.t('run_no_output') : window.I18N.t('run_error'));
    runBtn.textContent = r.ok ? window.I18N.t('run_done') : window.I18N.t('run_failed');
  });
  return card;
}

async function sendMessage(text) {
  text = (text || '').trim();
  if (!text) return;
  let c = activeConvo();
  if (!c) { newConvo(); c = activeConvo(); }
  if (c.msgs.length === 0) c.title = text.slice(0, 28);
  c.msgs.push({ role: 'user', text });
  renderMessages(); renderHistory();
  c.msgs.push({ role: 'assistant', text: '…' });
  renderMessages();
  clearActivity();
  logActivity('پیام ارسال شد');
  $('brandOrb').classList.add('thinking');
  try {
    logActivity('در حال فکر کردن...');
    let answer = await window.ChatCore.ask(text, c.msgs.slice(0, -1));
    logActivity('پاسخ آماده شد');
    const chart = window.Artifact.extractChart(answer);
    if (chart) logActivity('رسم نمودار');
    const act = window.Actions.parseAndStrip(answer);
    if (act.name) {
      logActivity('اجرای عملیات: ' + act.name);
      const r = await window.Actions.run(act.name, act.arg);
      answer = (act.clean ? act.clean + '\n' : '') + (r && r.ok ? window.I18N.t('action_done') : window.I18N.t('action_failed'));
    }
    c.msgs[c.msgs.length - 1] = { role: 'assistant', text: answer };
    const speakTyped = await window.nova.store.get('speakTyped', false);
    if (speakTyped) speakText(answer);
  } catch (err) {
    logActivity('خطا: ' + (err.message || err));
    c.msgs[c.msgs.length - 1] = { role: 'assistant', text: window.I18N.t('error_prefix') + (err.message || err) };
  }
  $('brandOrb').classList.remove('thinking');
  renderMessages();
  persistConvos();
}

// ---------- "behind the scenes" panel: a small arrow in the corner opens a real, live log of
// what the last turn actually did, instead of a fake decorative animation ----------
function logActivity(text) {
  const panel = $('activityPanel');
  const row = document.createElement('div'); row.className = 'step'; row.textContent = text;
  panel.appendChild(row); panel.scrollTop = panel.scrollHeight;
  $('activityToggle').classList.add('has-activity');
}
function clearActivity() { $('activityPanel').innerHTML = ''; }
$('activityToggle').addEventListener('click', () => $('activityPanel').classList.toggle('open'));
function persistConvos() { window.nova.store.set('convos', state.convos.slice(0, 40)); }

$('sendBtn').addEventListener('click', () => { const v = $('composerInput').value; $('composerInput').value = ''; sendMessage(v); });
$('composerInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('sendBtn').click(); }
});

// ---------- manual mic (push-to-talk in the chat screen) ----------
// Prefers real Whisper transcription (window.STT, needs a free STT key in Settings — accurate,
// and automatically stops recording once you stop talking). Falls back to the browser's own
// recognizer, which is unreliable in Electron, only if no STT key has been set yet.
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let micRecognizer = null, micOn = false;
$('micBtn').addEventListener('click', async () => {
  if (micOn) return;
  const offlineDictate = await window.nova.store.get('offlineDictate', false);
  const useWhisper = (await window.STT.sttKeyConfigured()) && (navigator.onLine || !offlineDictate);
  if (useWhisper) {
    micOn = true; $('micBtn').classList.add('active');
    try {
      const text = await window.STT.listenOnce({
        onThinking: () => { $('micBtn').textContent = '⏳'; },
      });
      if (text) sendMessage(text);
    } catch {}
    micOn = false; $('micBtn').classList.remove('active'); $('micBtn').textContent = '🎙';
    return;
  }
  if (!SpeechRecognitionCtor) { alert(window.I18N.t('err_stt_unsupported')); return; }
  micRecognizer = new SpeechRecognitionCtor();
  micRecognizer.lang = 'fa-IR';
  micRecognizer.onstart = () => { micOn = true; $('micBtn').classList.add('active'); };
  micRecognizer.onend = () => { micOn = false; $('micBtn').classList.remove('active'); };
  micRecognizer.onresult = (e) => { sendMessage(e.results[0][0].transcript); };
  micRecognizer.onerror = () => { micOn = false; $('micBtn').classList.remove('active'); };
  try { micRecognizer.start(); } catch {}
});

// ---------- attachments ----------
$('attachBtn').addEventListener('click', async () => {
  const files = await window.nova.files.openPicker();
  if (!files.length) return;
  let c = activeConvo(); if (!c) { newConvo(); c = activeConvo(); }
  c.msgs.push({ role: 'user', text: '', attachments: files.map((f) => ({ name: f.name, ext: f.ext })) });
  c.msgs.push({ role: 'assistant', text: '…' });
  renderMessages();
  try {
    const payloads = [];
    for (const f of files) {
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(f.ext)) {
        const b64 = await window.nova.files.readBase64(f.path);
        const mime = f.ext === '.png' ? 'image/png' : 'image/jpeg';
        payloads.push({ text: `Analyze the attached image: ${f.name}`, image: `data:${mime};base64,${b64}` });
      } else {
        const text = await window.nova.files.readText(f.path, 180000);
        payloads.push({ text: `Analyze this file named ${f.name}.\n\n${text}` });
      }
    }
    const cfg = await window.ChatCore.loadCfg();
    if (!window.ChatCore.configured(cfg)) throw new Error(window.I18N.t('err_connect_first'));
    const prompt = 'Answer in the user\'s language. Analyze the attached files carefully.\n\n' +
      payloads.map((p, i) => `--- Attachment ${i + 1} ---\n${p.text}`).join('\n\n');
    const images = payloads.filter((p) => p.image).map((p) => p.image);
    const answer = await window.nova.api.analyze({ base: cfg.base, key: cfg.key, model: cfg.model, text: prompt, images, maxTokens: cfg.devOk ? 1400 : 900 });
    c.msgs[c.msgs.length - 1] = { role: 'assistant', text: answer };
  } catch (err) {
    c.msgs[c.msgs.length - 1] = { role: 'assistant', text: window.I18N.t('error_prefix') + (err.message || err) };
  }
  renderMessages(); persistConvos();
});

// ---------- setup ----------
function renderProviderChips() {
  const el = $('providerChips'); el.innerHTML = '';
  PROVIDERS.forEach((p) => {
    const c = document.createElement('button'); c.className = 'chip' + (p.id === state.provider.id ? ' on' : '');
    c.textContent = p.name || window.I18N.t('provider_custom');
    c.addEventListener('click', () => {
      state.provider = p;
      $('apiBase').value = p.base;
      $('apiModel').value = p.models[0] || '';
      renderProviderChips();
    });
    el.appendChild(c);
  });
}
// ---------- offline AI (Ollama) ----------
const OLLAMA_CATALOG = [
  { name: 'llama3.2', blurb: '3B — small & fast, good default' },
  { name: 'llama3.1', blurb: '8B — stronger general model' },
  { name: 'mistral', blurb: '7B — fast, solid all-rounder' },
  { name: 'qwen2.5', blurb: '7B — strong multilingual (incl. Persian/Arabic)' },
  { name: 'gemma2', blurb: '9B — Google\'s open model' },
  { name: 'deepseek-r1', blurb: '7B — reasoning-focused' },
  { name: 'phi3', blurb: '3.8B — tiny, runs on weak hardware' },
  { name: 'codellama', blurb: '7B — code-focused' },
];
async function renderOllamaInstalled() {
  const list = await window.nova.ollama.installed();
  const el = $('ollamaInstalledList');
  if (!list.length) { el.className = 'empty-state'; el.textContent = window.I18N.t('offline_none_installed'); return; }
  el.className = ''; el.innerHTML = '';
  list.forEach((m) => {
    const row = document.createElement('div'); row.className = 'list-item';
    const left = document.createElement('span'); left.textContent = m.name;
    const useBtn = document.createElement('button'); useBtn.className = 'btn gold'; useBtn.textContent = window.I18N.t('ollama_use');
    useBtn.addEventListener('click', () => {
      state.provider = PROVIDERS.find((p) => p.id === 'ollama'); renderProviderChips();
      $('apiBase').value = 'http://localhost:11434/v1'; $('apiKey').value = ''; $('apiModel').value = m.name;
      window.nova.store.set('ollamaBase', 'http://localhost:11434/v1');
      window.nova.store.set('ollamaModel', m.name);
    });
    row.appendChild(left); row.appendChild(useBtn); el.appendChild(row);
  });
}
function renderOllamaCatalog() {
  const el = $('ollamaCatalog'); el.innerHTML = '';
  OLLAMA_CATALOG.forEach((entry) => {
    const row = document.createElement('div'); row.className = 'list-item';
    const left = document.createElement('span'); left.textContent = `${entry.name} — ${entry.blurb}`;
    const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = window.I18N.t('ollama_pull');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await window.nova.ollama.pull(entry.name);
    });
    row.dataset.model = entry.name;
    row.appendChild(left); row.appendChild(btn); el.appendChild(row);
  });
}
window.nova.on('ollama:progress', ({ model, line }) => {
  const row = document.querySelector(`#ollamaCatalog [data-model="${CSS.escape(model)}"], #ollamaCatalog div[data-model="${model}"]`);
  const btn = document.querySelector(`#ollamaCatalog div[data-model="${model}"] button`);
  if (btn) btn.textContent = window.I18N.tf('ollama_pulling', { model, line: line.slice(-24) });
});
window.nova.on('ollama:done', ({ model, ok }) => {
  const btn = document.querySelector(`#ollamaCatalog div[data-model="${model}"] button`);
  if (btn) { btn.disabled = false; btn.textContent = ok ? window.I18N.t('ollama_done').replace('{model}', model) : window.I18N.t('ollama_failed'); }
  if (ok) renderOllamaInstalled();
});
$('ollamaCheckBtn').addEventListener('click', async () => {
  const r = await window.nova.ollama.check();
  $('ollamaStatus').textContent = r.installed ? window.I18N.t('ollama_found') : window.I18N.t('ollama_not_found');
  $('ollamaStatus').className = r.installed ? 'status-ok' : 'status-err';
  if (r.installed) renderOllamaInstalled();
});
$('ollamaInstallLink').addEventListener('click', () => window.nova.shell.openExternal('https://ollama.com/download'));

$('fetchModelsBtn').addEventListener('click', async () => {
  $('setupStatus').textContent = '...'; $('setupStatus').className = '';
  try {
    const models = await window.nova.api.models({ base: $('apiBase').value, key: $('apiKey').value });
    const sel = $('modelList'); sel.innerHTML = ''; sel.style.display = 'block';
    models.forEach((m) => { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); });
    sel.onchange = () => { $('apiModel').value = sel.value; };
    $('setupStatus').textContent = window.I18N.tf('models_found', { n: models.length }); $('setupStatus').className = 'status-ok';
  } catch (err) { $('setupStatus').textContent = err.message; $('setupStatus').className = 'status-err'; }
});
$('testBtn').addEventListener('click', async () => {
  $('setupStatus').textContent = window.I18N.t('status_testing'); $('setupStatus').className = '';
  try {
    await window.nova.api.test({ base: $('apiBase').value, key: $('apiKey').value, model: $('apiModel').value });
    $('setupStatus').textContent = window.I18N.t('status_ok'); $('setupStatus').className = 'status-ok';
  } catch (err) { $('setupStatus').textContent = err.message; $('setupStatus').className = 'status-err'; }
});
$('saveApiBtn').addEventListener('click', async () => {
  const base = $('apiBase').value.trim(), key = $('apiKey').value.trim(), model = $('apiModel').value.trim();
  await window.nova.store.set('provider', state.provider.id);
  await window.nova.store.set('apiBase', base);
  await window.nova.store.set('apiKey', key);
  await window.nova.store.set('apiModel', model);
  // Remember this as the "cloud" or "ollama" profile too, so that with auto-switch on, Nova
  // can come back to the right one automatically when the internet drops or returns.
  if (base.includes('localhost') || base.includes('127.0.0.1')) {
    await window.nova.store.set('ollamaBase', base); await window.nova.store.set('ollamaModel', model);
  } else {
    await window.nova.store.set('cloudBase', base); await window.nova.store.set('cloudKey', key); await window.nova.store.set('cloudModel', model);
  }
  $('setupStatus').textContent = window.I18N.t('status_saved'); $('setupStatus').className = 'status-ok';
  switchScreen('chat');
});

// ---------- settings ----------
async function loadSettings() {
  $('assistantName').value = await window.nova.store.get('assistantName', '');
  $('sttKey').value = await window.nova.store.get('sttKey', '');
  $('webOnToggle').checked = await window.nova.store.get('webOn', true);
  $('speakTypedToggle').checked = await window.nova.store.get('speakTyped', false);
  $('wakeToggle').checked = await window.nova.store.get('wakeOn', false);
  $('allowExecToggle').checked = await window.nova.store.get('allowExec', false);
  $('buildFolderRow').style.display = $('allowExecToggle').checked ? 'block' : 'none';
  $('buildFolderPath').value = await window.nova.store.get('buildFolder', '');
  $('humorRange').value = await window.nova.store.get('humor', 40);
  $('offlineDictateToggle').checked = await window.nova.store.get('offlineDictate', false);
  $('autoOnlineToggle').checked = await window.nova.store.get('autoOnline', true);
  updateWakeHint();
  refreshDevUI(await window.nova.store.get('devOk', false));
  renderMemory();
  updateConnStatus();
}
$('offlineDictateToggle').addEventListener('change', (e) => window.nova.store.set('offlineDictate', e.target.checked));
$('autoOnlineToggle').addEventListener('change', (e) => window.nova.store.set('autoOnline', e.target.checked));

// ---------- connectivity: shows whether Nova is currently online or running on the local
// Ollama model, and (when "auto" is on) switches ChatCore over automatically ----------
async function updateConnStatus() {
  const el = $('connStatus'); if (!el) return;
  if (navigator.onLine) { el.textContent = window.I18N.t('conn_online'); el.className = 'hint status-ok'; return; }
  const hasOllama = await window.nova.ollama.installed().then((l) => l && l.length > 0).catch(() => false);
  el.textContent = window.I18N.t(hasOllama ? 'conn_offline' : 'conn_offline_no_ollama');
  el.className = hasOllama ? 'hint status-ok' : 'hint status-err';
}
window.addEventListener('online', updateConnStatus);
window.addEventListener('offline', updateConnStatus);
function updateWakeHint() {
  if (!$('wakeToggle').checked) { $('wakeHint').textContent = ''; return; }
  $('wakeHint').textContent = $('sttKey').value.trim()
    ? window.I18N.t('wake_hint_stt_on')
    : window.I18N.t('wake_hint_stt_off');
}
$('assistantName').addEventListener('change', (e) => window.nova.store.set('assistantName', e.target.value.slice(0, 20)));
$('sttKey').addEventListener('change', (e) => { window.nova.store.set('sttKey', e.target.value.trim()); updateWakeHint(); });
$('webOnToggle').addEventListener('change', (e) => window.nova.store.set('webOn', e.target.checked));
$('speakTypedToggle').addEventListener('change', (e) => window.nova.store.set('speakTyped', e.target.checked));
$('humorRange').addEventListener('change', (e) => window.nova.store.set('humor', Number(e.target.value)));
$('allowExecToggle').addEventListener('change', async (e) => {
  await window.nova.store.set('allowExec', e.target.checked);
  $('buildFolderRow').style.display = e.target.checked ? 'block' : 'none';
});
$('pickFolderBtn').addEventListener('click', async () => {
  const folder = await window.nova.files.pickFolder();
  if (folder) { $('buildFolderPath').value = folder; await window.nova.store.set('buildFolder', folder); }
});
$('wakeToggle').addEventListener('change', async (e) => {
  await window.nova.store.set('wakeOn', e.target.checked);
  updateWakeHint();
  await window.nova.tray.setWakeState(e.target.checked);
  $('wakeStatus').textContent = window.I18N.t(e.target.checked ? 'wake_on' : 'wake_off');
  if (e.target.checked) await window.nova.overlay.startWake(); else await window.nova.overlay.stopWake();
});

function refreshDevUI(on) {
  $('devLocked').style.display = on ? 'none' : 'block';
  $('devUnlocked').style.display = on ? 'block' : 'none';
}
$('devUnlockBtn').addEventListener('click', async () => {
  const ok = await window.nova.dev.verify($('devPin').value);
  if (ok) { await window.nova.store.set('devOk', true); $('devPin').value = ''; $('devMsg').textContent = ''; refreshDevUI(true); }
  else $('devMsg').textContent = window.I18N.t('status_wrong_pin');
});
$('devLockBtn').addEventListener('click', async () => { await window.nova.store.set('devOk', false); refreshDevUI(false); });
$('changeDevPinBtn').addEventListener('click', async () => {
  const v = $('newDevPin').value.trim();
  if (!v) return;
  await window.nova.dev.setPin(v);
  $('newDevPin').value = '';
  $('devMsg').style.color = '#4EE06A'; $('devMsg').textContent = window.I18N.t('status_pin_saved');
});

function renderMemory() {
  window.nova.store.get('memory', []).then((memory) => {
    const el = $('memoryList'); el.innerHTML = '';
    memory.forEach((m, i) => {
      const row = document.createElement('div'); row.className = 'list-item';
      const left = document.createElement('span'); left.textContent = m;
      const del = document.createElement('button'); del.className = 'del'; del.textContent = '🗑';
      del.addEventListener('click', async () => { memory.splice(i, 1); await window.nova.store.set('memory', memory); renderMemory(); });
      row.appendChild(left); row.appendChild(del); el.appendChild(row);
    });
  });
}
$('memoryAddBtn').addEventListener('click', async () => {
  const v = $('memoryInput').value.trim(); if (!v) return;
  const devOk = await window.nova.store.get('devOk', false);
  const memory = await window.nova.store.get('memory', []);
  if (memory.length >= (devOk ? 50 : 5)) { alert(window.I18N.t('memory_full')); return; }
  memory.push(v); await window.nova.store.set('memory', memory);
  $('memoryInput').value = ''; renderMemory();
});

// ---------- TTS voices ----------
function speakText(text) {
  if (!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  window.nova.store.get('ttsVoice', 'system-default').then((name) => {
    if (name && name !== 'system-default') {
      const v = window.speechSynthesis.getVoices().find((x) => x.name === name);
      if (v) u.voice = v;
    }
    window.speechSynthesis.speak(u);
  });
}
function loadVoiceList() {
  const voices = window.speechSynthesis.getVoices();
  const sel = $('voiceSelect'); sel.innerHTML = '';
  const def = document.createElement('option'); def.value = 'system-default'; def.textContent = window.I18N.t('voice_default');
  sel.appendChild(def);
  voices.forEach((v) => { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.lang} — ${v.name}`; sel.appendChild(o); });
  window.nova.store.get('ttsVoice', 'system-default').then((v) => { sel.value = v; });
}
if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoiceList;
$('voiceSelect').addEventListener('change', (e) => window.nova.store.set('ttsVoice', e.target.value));

// ---------- language ----------
$('uiLangSelect').addEventListener('change', async (e) => {
  await window.nova.store.set('uiLang', e.target.value);
  window.I18N.apply(e.target.value);
  // re-render parts built dynamically in JS (data-i18n only covers static markup)
  renderProviderChips(); renderHistory(); renderMessages(); renderMemory(); loadVoiceList(); renderOllamaCatalog(); renderOllamaInstalled();
  const act = document.querySelector('.nav-item.active'); if (act) switchScreen(act.dataset.screen);
  $('wakeStatus').textContent = window.I18N.t($('wakeToggle').checked ? 'wake_on' : 'wake_off');
  updateWakeHint();
});

// ---------- startup ----------
async function boot() {
  let uiLang = await window.nova.store.get('uiLang', null);
  if (!uiLang) { uiLang = window.I18N.detect(); await window.nova.store.set('uiLang', uiLang); }
  window.I18N.apply(uiLang);
  $('uiLangSelect').value = uiLang;
  renderProviderChips();
  renderOllamaCatalog();
  window.nova.ollama.check().then((r) => { if (r.installed) renderOllamaInstalled(); });
  const [provider, base, key, model] = await Promise.all([
    window.nova.store.get('provider', 'llm7'),
    window.nova.store.get('apiBase', PROVIDERS[0].base),
    window.nova.store.get('apiKey', ''),
    window.nova.store.get('apiModel', PROVIDERS[0].models[0]),
  ]);
  state.provider = PROVIDERS.find((p) => p.id === provider) || PROVIDERS[0];
  renderProviderChips();
  $('apiBase').value = base; $('apiKey').value = key; $('apiModel').value = model;

  state.convos = await window.nova.store.get('convos', []);
  if (!state.convos.length) newConvo(); else { state.activeConvoId = state.convos[0].id; renderHistory(); renderMessages(); }

  await loadSettings();
  loadVoiceList();

  const wakeOn = await window.nova.store.get('wakeOn', false);
  $('wakeStatus').textContent = window.I18N.t(wakeOn ? 'wake_on' : 'wake_off');
  await window.nova.tray.setWakeState(wakeOn);
  if (wakeOn) window.nova.overlay.startWake();

  if (!window.ChatCore.configured({ base, model })) switchScreen('setup');
}
window.nova.on('tray:toggleWake', () => { $('wakeToggle').click(); });
boot();
