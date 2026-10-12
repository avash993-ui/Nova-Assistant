const { contextBridge, ipcRenderer } = require('electron');

// Electron prefixes every IPC rejection with "Error invoking remote method 'x': Error: ...".
// Strip that so the person only ever sees our own clean message (this is the raw text people
// were seeing on screen before).
async function invoke(channel, ...args) {
  try { return await ipcRenderer.invoke(channel, ...args); }
  catch (e) {
    let msg = String((e && e.message) || e);
    msg = msg.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '');
    throw new Error(msg);
  }
}

contextBridge.exposeInMainWorld('nova', {
  store: {
    get: (key, def) => invoke('store:get', key, def),
    set: (key, val) => invoke('store:set', key, val),
    delete: (key) => invoke('store:delete', key),
  },
  dev: {
    verify: (pin) => invoke('dev:verify', pin),
    setPin: (pin) => invoke('dev:setPin', pin),
  },
  api: {
    chat: (cfg) => invoke('api:chat', cfg),
    analyze: (cfg) => invoke('api:analyze', cfg),
    test: (cfg) => invoke('api:test', cfg),
    models: (cfg) => invoke('api:models', cfg),
    transcribe: (cfg) => invoke('api:transcribe', cfg),
  },
  files: {
    openPicker: () => invoke('dialog:openFiles'),
    readBase64: (p) => invoke('file:readBase64', p),
    readText: (p, max) => invoke('file:readText', p, max),
    exportZip: (args) => invoke('export:zip', args),
    saveOne: (args) => invoke('file:saveOne', args),
    pickFolder: () => invoke('dialog:pickFolder'),
  },
  exec: { run: (args) => invoke('exec:run', args) },
  os: { runAction: (args) => invoke('os:action', args) },
  ollama: {
    check: () => invoke('ollama:check'),
    installed: () => invoke('ollama:installed'),
    pull: (model) => invoke('ollama:pull', { model }),
    cancelPull: (model) => invoke('ollama:cancelPull', { model }),
  },
  shell: { openExternal: (url) => invoke('shell:openExternal', url) },
  overlay: {
    show: () => invoke('overlay:show'),
    hide: () => invoke('overlay:hide'),
    startWake: () => invoke('overlay:startWakeListening'),
    stopWake: () => invoke('overlay:stopWakeListening'),
  },
  tray: { setWakeState: (on) => invoke('tray:setWakeState', on) },
  main: { openAndFocus: () => invoke('main:openAndFocus') },
  on: (channel, cb) => ipcRenderer.on(channel, (_e, ...args) => cb(...args)),
});
