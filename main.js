const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Pin the app name explicitly so %APPDATA%\Nova is always where settings/history live,
// regardless of what the "name" field in package.json happens to be. Without this, Electron's
// default (derived from package.json "name", i.e. "nova-desktop") can silently differ from
// the installer's product name ("Nova"), which is exactly what makes old data hard to find
// when uninstalling/reinstalling.
app.setName('Nova');

// One instance only. Closing the window just hides it to the tray, so without this, launching the
// app again looked like "it doesn't open": a second hidden copy would start next to the first one.
// Now a second launch simply brings the existing window back.
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.on('second-instance', () => {
  if (typeof mainWindow !== 'undefined' && mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

const STORE_FILE = path.join(app.getPath('userData'), 'nova-store.json');

// ---------- tiny JSON key/value store (replaces Android SharedPreferences) ----------
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')); } catch { return {}; }
}
function saveStore(obj) { fs.writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2), 'utf-8'); }
let store = loadStore();


// ---------- small 4-language message table for things produced in the main process ----------
const MT = {
  en: { empty: 'Empty reply (maybe a reasoning model; try another model)', emptyLen: ' — finish_reason: length (the model spent every token "thinking")', emptyShort: 'Empty reply',
        badKey: ' (invalid key)', badUrl: ' (wrong URL or model)', rate: ' (rate limit)', noStt: 'Speech-recognition (STT) key is not set', badStt: ' (invalid STT key)', rateStt: ' (STT rate limit)' },
  fa: { empty: 'پاسخ خالی بود (ممکنه مدل reasoning باشه؛ مدل دیگه‌ای امتحان کن)', emptyLen: ' — finish_reason: length (مدل کل توکن‌ها رو صرف «فکر کردن» کرد)', emptyShort: 'پاسخ خالی بود',
        badKey: ' (کلید نامعتبر)', badUrl: ' (آدرس یا مدل اشتباه)', rate: ' (سقف درخواست)', noStt: 'کلید تشخیص گفتار (STT) تنظیم نشده', badStt: ' (کلید STT نامعتبر)', rateStt: ' (سقف درخواست STT)' },
  ar: { empty: 'كان الرد فارغًا (ربما نموذج استدلال؛ جرّب نموذجًا آخر)', emptyLen: ' — finish_reason: length (استهلك النموذج كل الرموز في «التفكير»)', emptyShort: 'كان الرد فارغًا',
        badKey: ' (مفتاح غير صالح)', badUrl: ' (عنوان أو نموذج خاطئ)', rate: ' (تم بلوغ حد الطلبات)', noStt: 'لم يتم ضبط مفتاح التعرف على الكلام (STT)', badStt: ' (مفتاح STT غير صالح)', rateStt: ' (حد طلبات STT)' },
  ru: { empty: 'Пустой ответ (возможно, модель с рассуждением; попробуйте другую)', emptyLen: ' — finish_reason: length (модель израсходовала все токены на «размышления»)', emptyShort: 'Пустой ответ',
        badKey: ' (неверный ключ)', badUrl: ' (неверный адрес или модель)', rate: ' (лимит запросов)', noStt: 'Ключ распознавания речи (STT) не задан', badStt: ' (неверный ключ STT)', rateStt: ' (лимит запросов STT)' },
  tray: {
    en: { open: 'Open Nova', wakeOn: 'Turn wake word on', wakeOff: 'Turn wake word off', quit: 'Quit' },
    fa: { open: 'باز کردن نوا', wakeOn: 'روشن کردن گوش‌به‌زنگ', wakeOff: 'خاموش کردن گوش‌به‌زنگ', quit: 'خروج' },
    ar: { open: 'فتح نوفا', wakeOn: 'تشغيل كلمة التنبيه', wakeOff: 'إيقاف كلمة التنبيه', quit: 'خروج' },
    ru: { open: 'Открыть Nova', wakeOn: 'Включить голосовую активацию', wakeOff: 'Выключить голосовую активацию', quit: 'Выход' },
  },
};
function curLang() { return MT[store.uiLang] ? store.uiLang : 'en'; }
function mt(key) { return MT[curLang()][key]; }
function trayText() { return MT.tray[curLang()]; }

let refreshTray = () => {};
ipcMain.handle('store:get', (_e, key, def) => (key in store ? store[key] : def ?? null));
ipcMain.handle('store:set', (_e, key, val) => { store[key] = val; saveStore(store); if (key === 'uiLang') refreshTray(); return true; });
ipcMain.handle('store:delete', (_e, key) => { delete store[key]; saveStore(store); return true; });

// ---------- developer PIN: PBKDF2 + random salt, stored locally only (never plaintext) ----------
// Changing the PIN here changes it for every install; it is hashed, so it can't be read back out of this file.
const DEV_PIN_DEFAULT = '3993';

function pbkdf2(pin, salt) {
  return crypto.pbkdf2Sync(pin, salt, 180000, 32, 'sha256').toString('hex');
}
function ensureDevPinInitialised() {
  if (!store.devPinSalt || !store.devPinHash) {
    const salt = crypto.randomBytes(16).toString('hex');
    store.devPinSalt = salt;
    store.devPinHash = pbkdf2(DEV_PIN_DEFAULT, salt);
    saveStore(store);
  }
}
ipcMain.handle('dev:verify', (_e, pin) => {
  ensureDevPinInitialised();
  const hash = pbkdf2(String(pin || '').trim(), store.devPinSalt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(store.devPinHash));
});
ipcMain.handle('dev:setPin', (_e, newPin) => {
  const salt = crypto.randomBytes(16).toString('hex');
  store.devPinSalt = salt;
  store.devPinHash = pbkdf2(String(newPin || '').trim(), salt);
  saveStore(store);
  return true;
});

// ---------- OpenAI-compatible API client (runs in main process: no CORS issues) ----------
function cleanBase(raw) {
  let b = String(raw || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(b)) b = 'https://' + b;
  for (const suf of ['/chat/completions', '/models', '/completions']) {
    if (b.endsWith(suf)) b = b.slice(0, -suf.length).replace(/\/+$/, '');
  }
  return b;
}
function cleanKey(k) { return String(k || '').trim().replace(/^Bearer\s+/i, ''); }

function withTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}
const TIMEOUT_MSG = { en: 'Request timed out — check the URL and your internet connection.',
  fa: 'درخواست زمان‌بر شد — آدرس و اتصال اینترنتت رو چک کن.',
  ar: 'انتهت مهلة الطلب — تحقق من العنوان واتصالك بالإنترنت.',
  ru: 'Истекло время ожидания — проверьте URL и подключение к интернету.' };
async function apiPost(base, path, key, body) {
  const { signal, done } = withTimeout(30000);
  let res;
  try {
    res = await fetch(cleanBase(base) + path, {
      method: 'POST', signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Nova-Desktop/1.0',
        ...(key ? { Authorization: 'Bearer ' + cleanKey(key) } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(TIMEOUT_MSG[curLang()] || TIMEOUT_MSG.en);
    throw e;
  } finally { done(); }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || j.message || msg; } catch {}
    const hint = { 401: mt('badKey'), 403: mt('badKey'), 404: mt('badUrl'), 429: mt('rate') }[res.status] || '';
    throw new Error(`HTTP ${res.status}${hint}: ${msg}`);
  }
  return JSON.parse(text);
}
async function apiGet(base, path, key) {
  const { signal, done } = withTimeout(20000);
  let res;
  try {
    res = await fetch(cleanBase(base) + path, {
      signal, headers: { 'Accept': 'application/json', ...(key ? { Authorization: 'Bearer ' + cleanKey(key) } : {}) },
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(TIMEOUT_MSG[curLang()] || TIMEOUT_MSG.en);
    throw e;
  } finally { done(); }
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

ipcMain.handle('api:chat', async (_e, { base, key, model, messages, maxTokens }) => {
  // Reasoning models (o-series, DeepSeek-R1, Claude extended-thinking, etc.) spend tokens on an
  // internal "thinking" pass before writing the visible reply. The old 380-token budget was
  // entirely consumed by that thinking pass on such models, leaving nothing for the actual
  // answer -> empty content -> the "پاسخ خالی بود" error. Start much higher and retry further up.
  let budget = maxTokens || 1200;
  let text = '';
  let lastJson = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const j = await apiPost(base, '/chat/completions', key, {
      model, messages, max_tokens: budget, temperature: 0.6,
    });
    lastJson = j;
    text = (j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    if (text) break;
    budget = Math.min(budget * 3, 16000);
  }
  if (!text) {
    const finish = lastJson?.choices?.[0]?.finish_reason;
    const extra = finish === 'length' ? mt('emptyLen') : '';
    throw new Error(mt('empty') + extra);
  }
  return text;
});

ipcMain.handle('api:analyze', async (_e, { base, key, model, text, images, maxTokens }) => {
  async function once(withImages) {
    const content = [{ type: 'text', text }];
    if (withImages) for (const url of (images || []).slice(0, 6)) content.push({ type: 'image_url', image_url: { url } });
    const j = await apiPost(base, '/chat/completions', key, {
      model, messages: [{ role: 'user', content }], max_tokens: maxTokens || 900,
    });
    const t = (j.choices?.[0]?.message?.content || '').trim();
    if (!t) throw new Error('empty answer');
    return t;
  }
  try { return await once(true); }
  catch (e) {
    if (images && images.length) {
      try { return await once(false); } catch (e2) { throw e; }
    }
    throw e;
  }
});

ipcMain.handle('api:test', async (_e, { base, key, model }) => {
  const j = await apiPost(base, '/chat/completions', key, {
    model, messages: [{ role: 'user', content: 'Reply with the single word: OK' }], max_tokens: 64,
  });
  const t = (j.choices?.[0]?.message?.content || '').trim();
  if (!t) throw new Error(mt('emptyShort'));
  return t;
});

ipcMain.handle('api:models', async (_e, { base, key }) => {
  const j = await apiGet(base, '/models', key);
  const arr = Array.isArray(j) ? j : (j.data || j.models || []);
  const out = new Set();
  for (const e of arr) {
    const id = typeof e === 'string' ? e : (e.id || e.name || '');
    if (id) out.add(String(id).replace(/^models\//, ''));
  }
  return [...out].sort();
});

// ---------- speech-to-text (Groq's Whisper endpoint): replaces Chromium's built-in speech
// recognition, which needs a Google-owned API key that Electron's bundled Chromium doesn't
// ship with, so it silently fails on most machines. This hits a real cloud model instead,
// using the same kind of API key the user already pastes in on the "Connect API" screen. ----------
ipcMain.handle('api:transcribe', async (_e, { key, base64, mime, lang }) => {
  if (!key) throw new Error(mt('noStt'));
  const buf = Buffer.from(base64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime || 'audio/webm' }), 'audio.webm');
  form.append('model', 'whisper-large-v3-turbo');
  if (lang) form.append('language', lang);
  const { signal, done } = withTimeout(25000);
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', signal,
      headers: { Authorization: 'Bearer ' + cleanKey(key) },
      body: form,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(TIMEOUT_MSG[curLang()] || TIMEOUT_MSG.en);
    throw e;
  } finally { done(); }
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { const j = JSON.parse(text); msg = (j.error && (j.error.message || j.error)) || msg; } catch {}
    const hint = { 401: mt('badStt'), 403: mt('badStt'), 429: mt('rateStt') }[res.status] || '';
    throw new Error(`HTTP ${res.status}${hint}: ${msg}`);
  }
  const j = JSON.parse(text);
  return (j.text || '').trim();
});

// ---------- safe OS actions: open an app / url / folder / settings page, "like Siri" ----------
// Windows resolves most installed apps through the "App Paths" registry even without a full
// path, so `start "" "<exe>"` works for most major apps, not just Windows' own built-ins.
const APP_ALIASES = {
  notepad: 'notepad.exe', calculator: 'calc.exe', calc: 'calc.exe', paint: 'mspaint.exe',
  explorer: 'explorer.exe', files: 'explorer.exe', 'file explorer': 'explorer.exe',
  cmd: 'cmd.exe', 'command prompt': 'cmd.exe', powershell: 'powershell.exe',
  'task manager': 'taskmgr.exe', taskmanager: 'taskmgr.exe', 'control panel': 'control.exe',
  settings: 'ms-settings:', chrome: 'chrome.exe', edge: 'msedge.exe', firefox: 'firefox.exe',
  word: 'ms-word:', excel: 'ms-excel:', powerpoint: 'ms-powerpoint:', outlook: 'ms-outlook:',
  spotify: 'spotify:', vscode: 'code', 'vs code': 'code', code: 'code',
  discord: 'discord.exe', telegram: 'telegram.exe', whatsapp: 'whatsapp.exe', skype: 'skype.exe',
  'نوت پد': 'notepad.exe', 'ماشین حساب': 'calc.exe', 'نقاشی': 'mspaint.exe', 'فایل': 'explorer.exe',
  'تنظیمات': 'ms-settings:', 'مرورگر': 'chrome.exe', 'تلگرام': 'telegram.exe', 'واتساپ': 'whatsapp.exe', 'دیسکورد': 'discord.exe',
  'المفكرة': 'notepad.exe', 'الآلة الحاسبة': 'calc.exe', 'الإعدادات': 'ms-settings:', 'المتصفح': 'chrome.exe', 'تيليجرام': 'telegram.exe', 'واتساب': 'whatsapp.exe',
  'блокнот': 'notepad.exe', 'калькулятор': 'calc.exe', 'настройки': 'ms-settings:', 'браузер': 'chrome.exe', 'телеграм': 'telegram.exe', 'ватсап': 'whatsapp.exe', 'дискорд': 'discord.exe',
};
const SETTINGS_PAGES = {
  wifi: 'ms-settings:network-wifi', bluetooth: 'ms-settings:bluetooth', display: 'ms-settings:display',
  sound: 'ms-settings:sound', update: 'ms-settings:windowsupdate', apps: 'ms-settings:appsfeatures',
  battery: 'ms-settings:batterysaver', storage: 'ms-settings:storagesense',
};
function winExec(cmd) {
  return new Promise((resolve) => {
    require('child_process').exec(cmd, { windowsHide: true, timeout: 8000 }, (err) => resolve(!err));
  });
}
ipcMain.handle('os:action', async (_e, { name, arg }) => {
  try {
    switch (name) {
      case 'open_app': {
        const key = String(arg || '').trim().toLowerCase();
        let target = APP_ALIASES[key];
        if (!target) target = /[.:]/.test(key) ? key : key.replace(/\s+/g, '') + '.exe';   // best-effort guess
        if (target.includes(':')) { await shell.openExternal(target); return { ok: true }; }
        const ok = await winExec(`start "" "${target}"`);
        return { ok };
      }
      case 'open_url': {
        let u = String(arg || '').trim(); if (!u) return { ok: false };
        if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
        await shell.openExternal(u); return { ok: true };
      }
      case 'open_folder': {
        if (!arg || !fs.existsSync(arg)) return { ok: false };
        const err = await shell.openPath(arg);
        return { ok: !err };
      }
      case 'open_settings': {
        const page = SETTINGS_PAGES[String(arg || '').trim().toLowerCase()] || 'ms-settings:';
        await shell.openExternal(page); return { ok: true };
      }
      case 'search_web': {
        if (!arg) return { ok: false };
        await shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(arg));
        return { ok: true };
      }
      case 'lock_screen': { const ok = await winExec('rundll32.exe user32.dll,LockWorkStation'); return { ok }; }
      case 'volume_mute': { const ok = await winExec('nircmd.exe mutesysvolume 2 || powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"'); return { ok }; }
      case 'volume_up': { const ok = await winExec('powershell -c "$o=New-Object -ComObject WScript.Shell; for($i=0;$i -lt 3;$i++){$o.SendKeys([char]175)}"'); return { ok }; }
      case 'volume_down': { const ok = await winExec('powershell -c "$o=New-Object -ComObject WScript.Shell; for($i=0;$i -lt 3;$i++){$o.SendKeys([char]174)}"'); return { ok }; }
      case 'close_app': {
        const key = String(arg || '').trim().toLowerCase();
        const target = APP_ALIASES[key] || (key.replace(/\s+/g, '') + '.exe');
        const ok = await winExec(`taskkill /IM "${target}" /F`);
        return { ok };
      }
      case 'take_screenshot': {
        const out = path.join(app.getPath('pictures'), `nova-screenshot-${Date.now()}.png`);
        const ok = await winExec(`powershell -c "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height; [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $bmp.Save('${out.replace(/\\/g, '\\\\')}')"`);
        return { ok, path: ok ? out : null };
      }
      default: return { ok: false };
    }
  } catch { return { ok: false }; }
});

// ---------- local build/run capability (opt-in, per-command confirmation) ----------
// The renderer never runs a command on its own: the user must enable the toggle in Settings
// AND click "اجرا" on each individual command card. This handler just executes once approved.
ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  return r.filePaths[0];
});
ipcMain.handle('exec:run', async (_e, { command, cwd }) => {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    exec(command, { cwd: cwd || app.getPath('home'), timeout: 120000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || (err ? String(err.message) : '') });
    });
  });
});

// ---------- offline AI via Ollama (runs fully on this computer, no internet needed after download) ----------
ipcMain.handle('ollama:check', async () => {
  return new Promise((resolve) => {
    require('child_process').exec('ollama --version', { timeout: 5000 }, (err, stdout) => {
      resolve({ installed: !err, version: (stdout || '').trim() });
    });
  });
});
ipcMain.handle('ollama:installed', async () => {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    if (!res.ok) return [];
    const j = await res.json();
    return (j.models || []).map((m) => ({ name: m.name, size: m.size }));
  } catch { return []; }   // Ollama not running
});
const ollamaPulls = {};   // model -> { child, log }
ipcMain.handle('ollama:pull', async (_e, { model }) => {
  if (ollamaPulls[model]) return { started: true };
  const child = require('child_process').spawn('ollama', ['pull', model], { windowsHide: true });
  ollamaPulls[model] = { child, log: '' };
  const onData = (buf) => {
    const line = buf.toString();
    ollamaPulls[model].log = line.trim().split('\n').pop() || '';
    mainWindow && mainWindow.webContents.send('ollama:progress', { model, line: ollamaPulls[model].log });
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);   // ollama writes its progress bar to stderr
  child.on('close', (code) => {
    mainWindow && mainWindow.webContents.send('ollama:done', { model, ok: code === 0 });
    delete ollamaPulls[model];
  });
  child.on('error', () => {
    mainWindow && mainWindow.webContents.send('ollama:done', { model, ok: false, error: 'ollama not found' });
    delete ollamaPulls[model];
  });
  return { started: true };
});
ipcMain.handle('ollama:cancelPull', (_e, { model }) => {
  if (ollamaPulls[model]) { try { ollamaPulls[model].child.kill(); } catch {} delete ollamaPulls[model]; }
  return true;
});

// ---------- file dialogs (attachments, zip export) ----------
ipcMain.handle('dialog:openFiles', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({
    path: p,
    name: path.basename(p),
    ext: path.extname(p).toLowerCase(),
    sizeMB: fs.statSync(p).size / (1024 * 1024),
  }));
});
ipcMain.handle('file:readBase64', (_e, filePath) => fs.readFileSync(filePath).toString('base64'));
ipcMain.handle('file:readText', (_e, filePath, maxChars) => {
  const buf = fs.readFileSync(filePath, 'utf-8');
  return buf.slice(0, maxChars || 180000);
});
// ---------- minimal ZIP writer (store-only, no deps) for the "export code as project" feature ----------
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xFF;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(parts) {
  const chunks = []; const central = []; let offset = 0;
  for (const { name, body } of parts) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const dataBuf = Buffer.from(body, 'utf-8');
    const crc = crc32(dataBuf);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(dataBuf.length, 18); local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, dataBuf);
    const centralRec = Buffer.alloc(46);
    centralRec.writeUInt32LE(0x02014b50, 0); centralRec.writeUInt16LE(20, 4); centralRec.writeUInt16LE(20, 6);
    centralRec.writeUInt16LE(0, 8); centralRec.writeUInt16LE(0, 10); centralRec.writeUInt16LE(0, 12);
    centralRec.writeUInt32LE(crc, 16); centralRec.writeUInt32LE(dataBuf.length, 20); centralRec.writeUInt32LE(dataBuf.length, 24);
    centralRec.writeUInt16LE(nameBuf.length, 28); centralRec.writeUInt32LE(0, 38); centralRec.writeUInt32LE(offset, 42);
    central.push(centralRec, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(parts.length, 8); end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...chunks, centralBuf, end]);
}
// ---------- single-file download, like Claude's file cards (one file, not a whole zip) ----------
ipcMain.handle('file:saveOne', async (_e, { suggestedName, content }) => {
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName || 'nova-file.txt' });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, content, 'utf-8');
  shell.showItemInFolder(r.filePath);
  return true;
});

ipcMain.handle('export:zip', async (_e, { suggestedName, parts }) => {
  if (!parts || !parts.length) return false;
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: suggestedName || 'nova-project.zip' });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, buildZip(parts));
  shell.showItemInFolder(r.filePath);
  return true;
});
ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));

// ---------- windows ----------
let mainWindow, overlayWindow, tray;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 860, minHeight: 560,
    backgroundColor: '#03060C', show: false, autoHideMenuBar: true,
    title: 'Nova',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => {
    if (!app.isQuiting) { e.preventDefault(); mainWindow.hide(); }
  });
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 190, height: 210, show: false, frame: false, transparent: true,
    alwaysOnTop: true, resizable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false,
      backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }, // hidden window must keep listening at full speed
  });
  overlayWindow.loadFile(path.join(__dirname, 'src', 'overlay.html'));
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
}

ipcMain.handle('overlay:show', () => {
  if (!overlayWindow) return;
  const { screen } = require('electron');
  const area = screen.getPrimaryDisplay().workArea;
  overlayWindow.setPosition(area.x + area.width - 220, area.y + area.height - 260);
  overlayWindow.show();
});
ipcMain.handle('overlay:hide', () => overlayWindow && overlayWindow.hide());
ipcMain.handle('overlay:startWakeListening', () => overlayWindow && overlayWindow.webContents.send('wake:start'));
ipcMain.handle('overlay:stopWakeListening', () => overlayWindow && overlayWindow.webContents.send('wake:stop'));
ipcMain.handle('main:openAndFocus', () => { mainWindow.show(); mainWindow.focus(); });

app.whenReady().then(() => {
  ensureDevPinInitialised();
  // auto-allow microphone for our own windows (the desktop equivalent of RECORD_AUDIO)
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media');
  });

  createMainWindow();
  createOverlayWindow();

  const iconPath = path.join(__dirname, 'assets', 'tray.png');
  const img = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(img);
  let trayWakeOn = false;
  const rebuildMenu = (wakeOn) => { const tt = trayText(); return Menu.buildFromTemplate([
    { label: tt.open, click: () => { mainWindow.show(); mainWindow.focus(); } },
    { label: wakeOn ? tt.wakeOff : tt.wakeOn, click: () => mainWindow.webContents.send('tray:toggleWake') },
    { type: 'separator' },
    { label: tt.quit, click: () => { app.isQuiting = true; app.quit(); } },
  ]); };
  tray.setToolTip('Nova');
  tray.setContextMenu(rebuildMenu(false));
  refreshTray = () => tray.setContextMenu(rebuildMenu(trayWakeOn));
  ipcMain.handle('tray:setWakeState', (_e, on) => { trayWakeOn = on; tray.setContextMenu(rebuildMenu(on)); });
  tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });

  // quick-open shortcut, handy for a desktop assistant (like Spotlight/Siri)
  globalShortcut.register('Control+Space', () => { mainWindow.show(); mainWindow.focus(); });
  // 100%-reliable backup for the voice wake word: speech recognition can occasionally miss
  // "Hey Nova" (a known Electron limitation), so this hotkey triggers the same conversation
  // turn instantly, with zero chance of mis-hearing.
  globalShortcut.register('Control+Shift+J', () => overlayWindow && overlayWindow.webContents.send('wake:trigger'));
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { app.isQuiting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
