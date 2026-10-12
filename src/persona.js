// Ported (simplified) from engine/Persona.kt
window.Persona = (function () {
  function humorLine(humor) {
    if (humor >= 70) return 'لحنت شوخ و بامزه‌ست، گاهی یه طعنه‌ی سبک می‌زنی، ولی هیچ‌وقت جواب درست رو فدای شوخی نمی‌کنی.';
    if (humor >= 35) return 'لحنت دوستانه و کمی گرمه، نه خیلی جدی نه خیلی شوخ.';
    return 'لحنت مودب، مستقیم و حرفه‌ایه.';
  }

  function buildSystemPrompt({ assistantName, humor, lang, memory, allowExec }) {
    const name = assistantName || 'نوا';
    const LANG_NAMES = { en: 'English', fa: 'Persian (Farsi)', ar: 'Arabic', ru: 'Russian' };
    const langLine = `Reply in ${LANG_NAMES[lang] || 'English'} by default; if the user writes in another language, answer in that language instead.`;
    const mem = (memory && memory.length) ? `\nچیزهایی که باید دربارهٔ کاربر به‌خاطر داشته باشی:\n- ${memory.join('\n- ')}` : '';
    const fileLine = 'وقتی کدی می‌نویسی که باید به‌عنوان فایل ذخیره بشه، همیشه توی بلوک کد اول این خط رو بذار: // FILE: filename.ext (برای پایتون از # FILE: استفاده کن). هر فایل یه بلوک جدا.';
    const chartLine = 'اگه کاربر درخواست نمودار، آمار یا مقایسه‌ی عددی دقیق کرد، یه بلوک کد با زبان chart بنویس که فقط یه JSON خام داخلش باشه، با عددهای واقعی (نه فرضی/تزئینی)، دقیقاً به این شکل، و توی متن دوباره همون اعداد رو تکرار نکن:\n' +
      '```chart\n{"type":"bar","title":"عنوان کوتاه","labels":["برچسب۱","برچسب۲"],"values":[10,20]}\n```\n' +
      '"type" می‌تونه "bar"، "line" یا "pie" باشه. برای pie مجموع values لازم نیست ۱۰۰ باشه، درصدش خودکار محاسبه می‌شه. این نمودار با محور عددی، برچسب مقدار روی هر ستون/نقطه، و راهنمای رنگ (legend) خودکار نمایش داده می‌شه — هیچ‌وقت بدون عدد واقعی نساز.';
    const actionLine = 'اگه کاربر خواست یه برنامه رو باز/بسته کنی، یه آدرس وب رو باز کنی، یه پوشه رو نشون بدی، صفحه‌ای از تنظیمات ویندوز رو باز کنی، چیزی رو سرچ کنی، صدا رو تنظیم کنی، صفحه رو قفل کنی، یا از صفحه عکس بگیری، جواب رو با دقیقاً یکی از این خط‌ها (در آخر پاسخ) تموم کن تا خودکار و بی‌نیاز به تایید اجرا بشه:\n' +
      'ACTION: open_app | NAME   (مثلاً chrome، notepad، spotify، word، settings)\n' +
      'ACTION: close_app | NAME\n' +
      'ACTION: open_url | URL\n' +
      'ACTION: open_folder | FULL_PATH\n' +
      'ACTION: open_settings | wifi|bluetooth|display|sound|update|apps|battery|storage\n' +
      'ACTION: search_web | QUERY\n' +
      'ACTION: lock_screen\n' +
      'ACTION: volume_up\n' +
      'ACTION: volume_down\n' +
      'ACTION: volume_mute\n' +
      'ACTION: take_screenshot\n' +
      'این دستورات امنن و همیشه مجازن، حتی اگه حالت اجرای build خاموش باشه. برای هر کار دیگه‌ای روی سیستم که این لیست رو پوشش نمی‌ده (مثل نصب/حذف نرم‌افزار یا تغییرات دائمی)، فقط با RUN پیشنهاد بده تا کاربر تاییدش کنه؛ هیچ‌وقت خودسرانه فرض نکن دسترسی کامل داری.';
    const execLine = allowExec
      ? 'کاربر اجازه داده دستورهای ساخت/بیلد روی لپ‌تاپ خودش اجرا بشه. اگه لازم بود دستوری اجرا بشه (مثل npm install یا npm run build)، فقط یه خط به شکل دقیق RUN: <دستور> در انتهای پاسخ بنویس؛ کاربر قبل از اجرا تاییدش می‌کنه.'
      : 'کاربر اجازه‌ی اجرای دستور روی لپ‌تاپش رو نداده؛ هیچ‌وقت خط RUN ننویس، فقط دستور رو به‌عنوان متن راهنمایی بگو.';
    return [
      `اسمت «${name}»ه، یه دستیار هوشمند روی کامپیوتر کاربره که هم صحبت می‌کنه هم می‌تونه کارهای ساده‌ی روی سیستم رو انجام بده.`,
      humorLine(humor ?? 40),
      langLine,
      'جواب‌ها رو کوتاه و مفید نگه دار مگراینکه کاربر جزئیات بیشتر بخواد.',
      fileLine,
      chartLine,
      actionLine,
      execLine,
      mem,
    ].filter(Boolean).join('\n');
  }

  return { buildSystemPrompt };
})();
