// Audits the rendered emails against the email-rendering research checklist.
const fs = require('fs');
const dir = require('path').join(__dirname, '.preview');

function contrast(hex1, hex2) {
  const lum = (h) => {
    const c = h.replace('#', '');
    const v = [0, 2, 4].map(i => {
      let x = parseInt(c.substr(i, 2), 16) / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const a = lum(hex1), b = lum(hex2);
  return ((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
}

const files = ['preview-welcome.html', 'preview-recap.html', 'preview-recap-empty.html', 'preview-reset.html'];
let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

for (const f of files) {
  const p = dir + '/' + f;
  if (!fs.existsSync(p)) { console.log(`\n${f}: MISSING`); fails++; continue; }
  const h = fs.readFileSync(p, 'utf8');
  console.log(`\n── ${f} (${(h.length / 1024).toFixed(1)} KB)`);

  check('under 80KB (Gmail clips ~102KB)', h.length < 80 * 1024, `${(h.length/1024).toFixed(1)} KB`);
  check('<html lang>', /<html[^>]*\slang="en"/.test(h));
  check('<html dir>', /<html[^>]*\sdir="ltr"/.test(h));
  check('wrapper lang+dir', /role="article"[^>]*lang="en"[^>]*dir="ltr"/.test(h));
  check('role="article"', /role="article"/.test(h));
  check('exactly one <h1>', (h.match(/<h1/g) || []).length === 1, `${(h.match(/<h1/g)||[]).length} found`);
  check('<title> present', /<title>[^<]+<\/title>/.test(h));
  check('format-detection meta', /name="format-detection"/.test(h));
  check('x-apple-disable-message-reformatting', /x-apple-disable-message-reformatting/.test(h));
  check('color-scheme declared', /name="color-scheme"/.test(h));
  check('MSO PixelsPerInch', /PixelsPerInch/.test(h));
  check('MSO font override (else Outlook->Times)', /\[if mso\]><style>\* \{ font-family/.test(h));
  check('mso-line-height-rule', /mso-line-height-rule:exactly/.test(h));
  check('preheader padded', /&shy;/.test(h));
  check('VML button for Outlook', /v:roundrect/.test(h));

  // every layout table carries role=presentation
  const tables = (h.match(/<table/g) || []).length;
  const roled = (h.match(/<table[^>]*role="presentation"/g) || []).length;
  check('all tables role="presentation"', tables === roled, `${roled}/${tables}`);

  // no pure white/black (Apple Mail inversion heuristic keys on exact values)
  check('no #ffffff', !/#ffffff/i.test(h));
  check('no #000000', !/#000000/i.test(h));

  // every link on our own org domain, no shorteners
  const hrefs = [...h.matchAll(/href="(https?:\/\/[^"]+)"/g)].map(m => m[1]);
  const hosts = [...new Set(hrefs.map(u => { try { return new URL(u).hostname; } catch { return 'BAD'; } }))];
  check('all link hosts on getliveque.com', hosts.every(x => x.endsWith('getliveque.com')), hosts.join(', ') || 'none');
  check('no URL shortener', !/bit\.ly|tinyurl|t\.co\/|goo\.gl/i.test(h));

  // emoji check (house rule) — allow the text star glyphs U+2605/2606
  const emoji = h.match(/[\u{1F300}-\u{1FAFF}\u{2B50}\u{2728}]/gu);
  check('no emoji (text glyphs only)', !emoji, emoji ? emoji.join('') : '');

  // no webfonts
  check('no webfont / @import', !/@import|fonts\.googleapis/.test(h));
  check('no external stylesheet', !/<link[^>]*stylesheet/.test(h));

  // style block budget (Gmail drops the whole block past ~8KB)
  const styles = [...h.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1].length);
  check('each <style> under 8KB', styles.every(n => n < 8192), styles.join('/') + ' chars');
}

console.log('\n── contrast (WCAG AA: 4.5:1 body, 3:1 large)');
const pairs = [
  // Dark palette, taken from index.html. Surfaces are the solid equivalents of
  // the app's rgba(255,255,255,x) over #080808.
  ['body copy on card', '#d6d6d8', '#141414'],
  ['stat label on tile', '#a8a8ad', '#202020'],
  ['footer text on card', '#8d8d95', '#141414'],
  ['white heading on card', '#fffffe', '#141414'],
  ['teal number on tile', '#4ecdc4', '#202020'],
  ['gold number on tile', '#ffd700', '#202020'],
  ['coral number on tile', '#ff6b6b', '#202020'],
  ['gold hero on tile', '#ffd700', '#202020'],
  ['teal link on card', '#4ecdc4', '#141414'],
  ['ink on teal button', '#06251f', '#4ecdc4'],
];
for (const [name, fg, bg] of pairs) {
  const r = contrast(fg, bg);
  const ok = r >= 4.5;
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${r.toFixed(2)}:1`);
}

console.log(fails === 0 ? '\nALL CHECKS PASS' : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
