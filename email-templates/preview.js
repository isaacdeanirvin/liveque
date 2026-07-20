// Renders the REAL templates out of liveque-email/index.ts so the preview can't
// drift from what actually ships. Strips Deno/TS bits, then evaluates.
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'supabase', 'functions', 'liveque-email', 'index.ts');
let src = fs.readFileSync(path, 'utf8');

// Drop imports, the serve() handler, and Deno env reads.
src = src.replace(/^import .*$/gm, '');
src = src.replace(/serve\(async \(req\) => \{[\s\S]*$/m, '');
src = src.replace(/Deno\.env\.get\("RESEND_API_KEY"\)!/g, '"x"');
src = src.replace(/Deno\.env\.get\("EMAIL_FROM"\) \|\| /g, '');
src = src.replace(/Deno\.env\.get\("EMAIL_REPLY_TO"\) \|\| /g, '');
src = src.replace(/Deno\.env\.get\("SWEEP_SECRET"\) \|\| /g, '');
src = src.replace(/Deno\.env\.get\("SUPABASE_URL"\)!/g, '"x"');
src = src.replace(/Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)!/g, '"x"');
// Strip TS annotations: param types, return types, and `as X` casts.
src = src.replace(/async function sendResend[\s\S]*$/m, '');
src = src.replace(/:\s*Record<string,\s*unknown>/g, '');
src = src.replace(/:\s*(string|unknown|number|boolean)(?=\s*[,)])/g, '');
src = src.replace(/\)\s*:\s*(string|number|boolean)\s*\{/g, ') {');
src = src.replace(/\s+as\s+string/g, '');

// new Function keeps the evaluated declarations out of this file's scope.
const { welcomeHtml, recapHtml, welcomeText, recapText } =
  new Function(src + '\nreturn { welcomeHtml, recapHtml, welcomeText, recapText };')();

const stats = {
  gigDate: 'Friday, July 17 · The Mint, Los Angeles',
  duration: '3h 20m',
  songsPlayed: 34,
  requests: 51,
  tipsTotal: 1234.5,          // the old code rendered this as "$1234.5"
  tipsCount: 18,
  topSong: 'Free Fallin\' — Tom Petty',
  ratingAvg: '4.6',
  ratingCount: 23,
};

const out = require('path').join(__dirname, '.preview');
require('fs').mkdirSync(out, { recursive: true });
fs.writeFileSync(out + '/preview-welcome.html', welcomeHtml('Glen'));
fs.writeFileSync(out + '/preview-recap.html', recapHtml('Glen', stats));
// A thin gig proves the conditional tiles degrade instead of leaving holes.
fs.writeFileSync(out + '/preview-recap-empty.html', recapHtml('Glen', {
  gigDate: 'Tuesday, July 21', duration: '45m', songsPlayed: 9,
  requests: 11, tipsTotal: 0, tipsCount: 0, topSong: null, ratingAvg: '', ratingCount: 0,
}));

console.log('welcome  :', welcomeHtml('Glen').length, 'bytes');
console.log('recap    :', recapHtml('Glen', stats).length, 'bytes  (Gmail clips at 102KB)');
console.log('money fix:', /\$1,234\.50/.test(recapHtml('Glen', stats)) ? 'OK  $1,234.50' : 'FAIL');
console.log('preheader:', /1,234\.50 in tips/.test(recapHtml('Glen', stats)) ? 'OK' : 'FAIL');
console.log('plaintext:', recapText('Glen', stats).split('\n').length, 'lines');
