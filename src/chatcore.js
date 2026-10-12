// Shared by index.html (full chat) and overlay.html (wake conversations), so a wake turn
// and a typed turn behave identically — mirrors how NovaViewModel.send() is the single
// code path for both in the Android app.
window.ChatCore = (function () {
  async function loadCfg() {
    const [base, key, model, assistantName, humor, lang, memory, devOk, allowExec, autoOnline,
      cloudBase, cloudKey, cloudModel, ollamaBase, ollamaModel] = await Promise.all([
      window.nova.store.get('apiBase', ''),
      window.nova.store.get('apiKey', ''),
      window.nova.store.get('apiModel', ''),
      window.nova.store.get('assistantName', 'نوا'),
      window.nova.store.get('humor', 40),
      window.nova.store.get('uiLang', 'en'),
      window.nova.store.get('memory', []),
      window.nova.store.get('devOk', false),
      window.nova.store.get('allowExec', false),
      window.nova.store.get('autoOnline', true),
      window.nova.store.get('cloudBase', ''), window.nova.store.get('cloudKey', ''), window.nova.store.get('cloudModel', ''),
      window.nova.store.get('ollamaBase', ''), window.nova.store.get('ollamaModel', ''),
    ]);
    let pickedBase = base, pickedKey = key, pickedModel = model;
    // With both a cloud and a local profile saved, auto-switching picks whichever matches the
    // actual connection right now — offline always gets the local model, no wasted cloud calls.
    if (autoOnline && cloudBase && ollamaBase) {
      if (navigator.onLine) { pickedBase = cloudBase; pickedKey = cloudKey; pickedModel = cloudModel; }
      else { pickedBase = ollamaBase; pickedKey = ''; pickedModel = ollamaModel; }
    }
    return { base: pickedBase, key: pickedKey, model: pickedModel, assistantName, humor, lang, memory, devOk, allowExec };
  }

  function configured(cfg) { return !!(cfg.base && cfg.model); }

  async function ask(question, history) {
    const cfg = await loadCfg();
    if (!configured(cfg)) throw new Error(window.I18N ? window.I18N.t('err_connect_first') : 'Connect an AI service first.');
    const system = window.Persona.buildSystemPrompt(cfg);
    const messages = [{ role: 'system', content: system }];
    (history || []).slice(-10).forEach((m) => messages.push({ role: m.role, content: m.text }));
    messages.push({ role: 'user', content: question });
    const answer = await window.nova.api.chat({
      base: cfg.base, key: cfg.key, model: cfg.model, messages,
      maxTokens: cfg.devOk ? 2200 : 1200,
    });
    return answer;
  }

  async function appendHistory(role, text) {
    const list = await window.nova.store.get('liveMessages', []);
    list.push({ role, text, t: Date.now() });
    await window.nova.store.set('liveMessages', list.slice(-200));
    return list;
  }

  return { loadCfg, configured, ask, appendHistory };
})();
