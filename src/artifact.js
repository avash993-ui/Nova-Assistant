// Ported from data/ArtifactWriter.kt
window.Artifact = (function () {
  const block = /```[A-Za-z0-9_+.-]*\s*\n([\s\S]*?)```/g;
  const fileNameRe = /^\s*(?:\/\/|#|\/\*)\s*FILE:\s*([^*\n]+?)(?:\*\/)?\s*$/im;
  function safe(s) { return (s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'file.txt'; }

  function extract(text) {
    const out = [];
    let m, i = 0;
    while ((m = block.exec(text))) {
      let body = m[1].replace(/\s+$/, '');
      const header = fileNameRe.exec(body);
      const name = (header ? header[1].trim() : '') || `nova_output_${++i}.txt`;
      if (header) body = body.slice(0, header.index) + body.slice(header.index + header[0].length);
      body = body.replace(/^\s+/, '');
      if (body.trim()) out.push({ name: safe(name), body });
    }
    block.lastIndex = 0;
    return out;
  }

  // ---------- chart: any fenced block (```chart or ```json) whose JSON has numeric "values" ----------
  // Expected shape: {"type":"bar"|"line","title":"...","labels":["a","b"],"values":[1,2]}
  const anyFence = /```(chart|json)?[ \t]*\r?\n([\s\S]*?)```/gi;
  function findChart(text) {
    anyFence.lastIndex = 0;
    let m;
    while ((m = anyFence.exec(text))) {
      try {
        const spec = JSON.parse(m[2].trim());
        if (spec && Array.isArray(spec.values) && spec.values.length && spec.values.every((v) => isFinite(Number(v)))) {
          if (!Array.isArray(spec.labels)) spec.labels = spec.values.map((_, i) => String(i + 1));
          return { spec, raw: m[0] };
        }
      } catch { /* not a chart block */ }
    }
    return null;
  }
  function extractChart(text) { const f = findChart(text); return f ? f.spec : null; }
  function stripChart(text) { const f = findChart(text); return f ? text.replace(f.raw, '').trim() : text; }

  return { extract, extractChart, stripChart };
})();
