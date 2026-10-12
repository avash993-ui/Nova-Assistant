// Parses an "ACTION: name | argument" line from the model's reply and runs it through the
// main process (window.nova.os.runAction). These are a small, safe, whitelisted set — opening
// an app/url/folder/settings page — so unlike the generic "RUN:" build command, they execute
// immediately with no confirmation card, the same way the Android app's Actions.kt does.
window.Actions = (function () {
  const re = /ACTION:\s*([A-Za-z_]+)\s*(?:\|\s*([^\n]*))?/i;

  function parseAndStrip(text) {
    const m = re.exec(text);
    if (!m) return { clean: text, name: null, arg: '' };
    return { clean: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(), name: m[1].toLowerCase(), arg: (m[2] || '').trim() };
  }

  async function run(name, arg) {
    if (!name) return null;
    try { return await window.nova.os.runAction({ name, arg }); }
    catch { return { ok: false }; }
  }

  return { parseAndStrip, run };
})();
