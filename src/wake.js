// Ported from voice/Wake.kt in the Android app.
window.Wake = (function () {
  const variants = ['hey nova', 'nova', 'هی نوا', 'نوا', 'نواجان', 'نووا', 'نوآ', 'نو وا'];

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ')
      .replace(/[\u064B-\u065F\u0640]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  function matches(text, name) {
    const t = norm(text);
    const n = norm(name);
    const isDefault = !n || n === 'nova' || n === 'نوا';
    if (n.length >= 3 && t.includes(n)) return true;
    return isDefault && variants.some((v) => t.includes(norm(v)));
  }

  return { norm, matches };
})();
