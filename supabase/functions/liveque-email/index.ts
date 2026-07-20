// liveque-email -- transactional email via Resend (welcome + gig recap).
//
// THIS IS THE ONLY PLACE LIVEQUE EMAIL TEMPLATES LIVE. gig-recap-sweeper used to
// carry its own copy of recapHtml() and the two drifted apart (differing closer
// and footer copy), so the auto-sent recap -- the one most performers actually
// get, since forgetting to hit End Gig is the norm -- did not match the manual
// one. The sweeper calls this function now. Do not reintroduce a second copy.
//
// THESE EMAILS ARE DARK BECAUSE THE APP IS DARK.
// Every value here is lifted from index.html -- #080808 body, the glass card at
// rgba(255,255,255,0.05) with a 0.08 border, .stat-item at radius 10 with a 24px
// bold number and a 12px 0.8-opacity label, the .auth-btn teal gradient with
// white text, the 28px/600 wordmark. rgba is precomputed to solid hex because
// Outlook has no rgba; over a known background it resolves identically.
//
// Known tradeoff, accepted deliberately: Gmail's mobile apps and classic Outlook
// force-invert dark mail for dark-mode users and ignore prefers-color-scheme, so
// those users may see a lightened version. Matching the product was judged more
// important than byte-identical rendering in every client.
//
// Security -- two callers, two auth modes:
//   1. A performer's browser presents a Supabase auth JWT. The email always goes
//      to that verified user's own address; the client cannot name a recipient.
//   2. The sweeper (server-side cron) presents x-internal-secret matching
//      SWEEP_SECRET and may name the recipient. That secret never reaches a browser.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM, EMAIL_REPLY_TO, SWEEP_SECRET,
//          SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "LiveQue <onboarding@resend.dev>";
const EMAIL_REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") || "";
const SWEEP_SECRET = Deno.env.get("SWEEP_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SITE = "https://getliveque.com";

// -- Palette ------------------------------------------------------------
// These are index.html's values, not new ones. The app uses translucent white
// over #080808; Outlook has no rgba, so each surface is precomputed to the
// solid it resolves to over the known background -- visually identical, works
// everywhere.
const C = {
  page: "#080808",       // body background, straight from the app
  card: "#141414",       // = rgba(255,255,255,0.05) over #080808
  tile: "#202020",       // = the same 0.05 again, over the card
  line: "#1c1c1c",       // = rgba(255,255,255,0.08)
  soft: "#212121",       // = rgba(255,255,255,0.1), the .control-btn fill
  white: "#fffffe",      // not pure #ffffff -- dodges Apple Mail's invert heuristic
  body: "#d6d6d8",       // white at ~0.84, the app's body copy weight
  dim: "#a8a8ad",        // .stat-label / .song-artist at opacity 0.8
  faint: "#8d8d95",      // .requester-name at opacity 0.6
  teal: "#4ecdc4",       // Requests + brand
  tealTo: "#44a08d",     // the .auth-btn gradient partner
  gold: "#ffd700",       // Tips Today + money + ratings
  coral: "#ff6b6b",      // Songs + the default .queue-item left border
  goldInk: "#1a1a2e",    // .priority-badge text on gold
};

// The app is 'Segoe UI' first -- which also happens to be the one stack Outlook
// renders correctly. A leading -apple-system makes the Word engine fall back to
// Times New Roman for the whole message.
const SANS = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";

function esc(v: unknown): string {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

function money(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) return "$0.00";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(v: unknown): string {
  const n = Number(v);
  return isFinite(n) ? n.toLocaleString("en-US") : "0";
}

// Padding so the client stops pulling body copy into the preview line. The old
// &#847;&zwnj;&nbsp; chain stopped working in Apple Mail; &shy; is what fixed it.
const PREHEAD_PAD = "&#847;&zwnj;&nbsp;&shy;".repeat(30);

function shell(inner: string, preheader: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=yes" />
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>${esc(title)}</title>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<!--[if mso]><style>* { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important; }</style><![endif]-->
<style>
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  td { mso-line-height-rule:exactly; }
  img { border:0; display:block; -ms-interpolation-mode:bicubic; }
  body { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  h1 { margin:0 0 6px; font-size:22px; line-height:1.3; font-weight:700; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
</style>
</head>
<body class="body" style="margin:0; padding:0; background-color:${C.page};">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${C.page}; opacity:0;">${esc(preheader)}${PREHEAD_PAD}</div>
<div role="article" aria-roledescription="email" aria-label="${esc(title)}" lang="en" dir="ltr" style="font-family:${SANS}; font-size:medium; font-size:max(16px,1rem);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.page};">
  <tr><td align="center" style="padding:20px 10px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:560px;">

      <!-- Header: the app's .header -- glass card, radius 20, centred wordmark. -->
      <tr><td align="center" style="background-color:${C.card}; border:1px solid ${C.line}; border-radius:20px; padding:18px 16px;">
        <div style="font-size:28px; font-weight:600; color:${C.white}; letter-spacing:-0.5px; font-family:${SANS};">LiveQue<span style="font-size:12px; vertical-align:super;">&#8482;</span></div>
        <div style="font-size:12px; color:${C.dim}; margin-top:4px; font-family:${SANS};">Live song requests &amp; tipping for musicians</div>
      </td></tr>
      <tr><td style="height:12px; font-size:0; line-height:0;">&nbsp;</td></tr>

      ${inner}

      <tr><td style="height:12px; font-size:0; line-height:0;">&nbsp;</td></tr>
      <tr><td style="background-color:${C.card}; border:1px solid ${C.line}; border-radius:15px; padding:14px 16px; font-size:11px; line-height:1.6; color:${C.faint}; font-family:${SANS}; text-align:center;">
        Sent by LiveQue &middot; <a href="${SITE}" style="color:${C.teal}; text-decoration:none;">getliveque.com</a><br />
        Reply to this email with any feedback &mdash; we read every one.
      </td></tr>
    </table>
  </td></tr>
</table>
</div>
</body>
</html>`;
}

// -- Tiles --------------------------------------------------------------
// .stat-item from index.html: centred, rgba(255,255,255,0.05) fill, 12px pad,
// radius 10, number 24px bold in the metric's colour, label 12px at 0.8 opacity.
// The hero is the same tile with the number scaled up -- not a new component.

function card(inner: string, radius = 15, pad = "14px 16px"): string {
  return `<tr><td style="background-color:${C.card}; border:1px solid ${C.line}; border-radius:${radius}px; padding:${pad};">${inner}</td></tr>
  <tr><td style="height:10px; font-size:0; line-height:0;">&nbsp;</td></tr>`;
}

function heroTile(value: string, label: string, color: string): string {
  return card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="background-color:${C.tile}; border-radius:10px; padding:22px 12px;">
      <div style="font-size:40px; font-weight:700; color:${color}; line-height:1.1; font-family:${SANS}; white-space:nowrap;">${esc(value)}</div>
      <div style="font-size:12px; color:${C.dim}; margin-top:6px; font-family:${SANS};">${esc(label)}</div>
    </td></tr>
  </table>`);
}

function statTile(value: string, label: string, color: string): string {
  return `<div style="display:inline-block; width:100%; max-width:250px; vertical-align:top; font-size:16px;">
    <div style="padding:0 5px 10px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.tile}; border-radius:10px;">
        <tr><td align="center" style="padding:14px 10px;">
          <div style="font-size:24px; font-weight:700; color:${color}; line-height:1.15; font-family:${SANS}; white-space:nowrap;">${esc(value)}</div>
          <div style="font-size:12px; color:${C.dim}; margin-top:4px; font-family:${SANS};">${esc(label)}</div>
        </td></tr>
      </table>
    </div>
  </div>`;
}

function tileRow(a: string, b: string): string {
  return `<div style="text-align:center; font-size:0;">
      <!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="250" valign="top"><![endif]-->
      ${a}
      <!--[if mso]></td><td width="250" valign="top"><![endif]-->
      ${b}
      <!--[if mso]></td></tr></table><![endif]-->
    </div>`;
}

// .auth-btn: teal gradient, radius 10, white bold. Gradient with a solid
// fallback underneath so Outlook still gets a filled teal button.
function ctaButton(href: string, text: string): string {
  return `<!--[if mso]>
  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:44px;v-text-anchor:middle;width:240px;" arcsize="23%" stroke="f" fillcolor="${C.teal}">
    <w:anchorlock/><center style="color:#06251f;font-family:'Segoe UI',Tahoma,sans-serif;font-size:15px;font-weight:700;">${esc(text)}</center>
  </v:roundrect>
  <![endif]-->
  <!--[if !mso]><!-- -->
  <a href="${href}" style="background-color:${C.teal}; background:linear-gradient(45deg,${C.teal},${C.tealTo}); border-radius:10px; color:#06251f; display:inline-block; font-family:${SANS}; font-size:15px; font-weight:700; line-height:44px; text-align:center; text-decoration:none; width:240px; mso-hide:all;">${esc(text)}</a>
  <!--<![endif]-->`;
}

// -- Welcome ------------------------------------------------------------
function welcomeHtml(name: string): string {
  const hi = name ? `Welcome to LiveQue, ${esc(name)}` : "Welcome to LiveQue";
  const inner = card(`
    <h1 style="color:${C.white}; font-family:${SANS};">${hi}</h1>
    <p style="margin:12px 0 12px; font-size:15px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      We're <b style="color:${C.white};">Isaac &amp; Glen Irvin</b> &mdash; two brothers who play out, same as you.
      We built LiveQue because we wanted a better way to connect a room to the person on stage:
      let people <b style="color:${C.white};">request songs</b>, <b style="color:${C.white};">tip to bump their pick</b>,
      and we don't take a cut of it.
    </p>
    <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      You're all set. Add your songs, put your QR code on the tables, and start your first gig whenever you're ready.
    </p>
    <div style="text-align:center; padding-bottom:6px;">${ctaButton(SITE, "Open your dashboard")}</div>
  `)
  + card(`
    <p style="margin:0 0 12px; font-size:14px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      We'd genuinely love your feedback &mdash; tell us what you love and what we can make better. Just reply to this email.
    </p>
    <p style="margin:0; font-size:14px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      Thanks for playing with us,<br /><b style="color:${C.white};">Isaac &amp; Glen Irvin</b>
    </p>
  `);
  return shell(inner, "You're set up. Add your songs, print your QR code, and start your first gig.", "Welcome to LiveQue");
}

function welcomeText(name: string): string {
  return `${name ? `Welcome to LiveQue, ${name}` : "Welcome to LiveQue"}

We're Isaac & Glen Irvin - two brothers who play out, same as you. We built
LiveQue because we wanted a better way to connect a room to the person on
stage: let people request songs, tip to bump their pick, and we don't take a cut
of it.

You're all set. Add your songs, put your QR code on the tables, and start your
first gig whenever you're ready.

Open your dashboard: ${SITE}

We'd genuinely love your feedback - tell us what you love and what we can make
better. Just reply to this email.

Thanks for playing with us,
Isaac & Glen Irvin

--
Sent by LiveQue - getliveque.com`;
}

// -- Recap --------------------------------------------------------------
function recapHtml(name: string, s: Record<string, unknown>): string {
  const tips = money(s.tipsTotal);
  const rc = Number(s.ratingCount) || 0;
  const dur = s.duration ? String(s.duration) : "--";
  const earned = Number(s.tipsTotal) > 0;

  // A night with no tips should not open with a giant $0.00 -- lead with what
  // they did do, and drop tips out of the grid rather than showing zero twice.
  const hero = earned
    ? heroTile(tips, "Tips collected", C.gold)
    : heroTile(num(s.songsPlayed), "Songs played", C.coral);

  // Colours are the dashboard's Live Stats, unchanged: Requests teal, Tips
  // gold, Songs coral.
  const rows = earned
    ? tileRow(statTile(num(s.songsPlayed), "Songs played", C.coral), statTile(num(s.tipsCount), "Tips", C.gold))
      + tileRow(statTile(num(s.requests), "Requests", C.teal), statTile(dur, "Set length", C.white))
    : tileRow(statTile(num(s.requests), "Requests", C.teal), statTile(dur, "Set length", C.white));

  // .queue-item.priority -- gold left border over a gold-tinted fill.
  const top = s.topSong
    ? card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#2a2410; border-left:4px solid ${C.gold}; border-radius:10px;">
        <tr><td style="padding:12px 14px;">
          <div style="font-size:12px; color:${C.dim}; font-family:${SANS};">Crowd favorite</div>
          <div style="font-size:16px; font-weight:700; color:${C.white}; margin-top:3px; font-family:${SANS};">${esc(s.topSong)}</div>
        </td></tr>
      </table>`)
    : "";

  // U+2605/U+2606 text glyphs, not the emoji star -- the app uses the same
  // entities, and a text glyph inherits colour and size.
  const rating = rc > 0
    ? (() => {
        const r = Math.max(0, Math.min(5, Math.round(Number(s.ratingAvg) || 0)));
        const glyphs = "&#9733;".repeat(r) + "&#9734;".repeat(5 - r);
        return card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.tile}; border-radius:10px;">
          <tr><td align="center" style="padding:14px 12px;">
            <div style="font-size:22px; color:${C.gold}; letter-spacing:3px; line-height:1.2;" aria-hidden="true">${glyphs}</div>
            <div style="font-size:12px; color:${C.dim}; margin-top:6px; font-family:${SANS};">${esc(s.ratingAvg)} average from ${rc} rating${rc === 1 ? "" : "s"}</div>
          </td></tr>
        </table>`)
      })()
    : "";

  const head = card(`
    <h1 style="color:${C.white}; font-family:${SANS};">That's a wrap${name ? ", " + esc(name) : ""}.</h1>
    <div style="font-size:12px; color:${C.faint}; font-family:${SANS};">${esc(s.gigDate || "")}</div>
  `);

  // Tiles carry a 10px bottom gutter, so the grid card trims its own bottom
  // padding rather than pulling content up with a negative margin.
  const grid = card(rows, 15, "14px 11px 4px");

  const foot = card(`
    <p style="margin:0 0 14px; font-size:14px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      Nicely done. Your queue and tips reset for next time &mdash; break a leg out there.
    </p>
    <div style="text-align:center; padding-bottom:8px;">${ctaButton(SITE, "See all your gigs")}</div>
    <p style="margin:0; font-size:13px; color:${C.faint}; font-family:${SANS}; text-align:center;">&mdash; Isaac &amp; Glen, LiveQue</p>
  `);

  const pre = earned
    ? `${tips} in tips${s.songsPlayed ? `, ${num(s.songsPlayed)} songs played` : ""}${s.topSong ? `. Crowd favorite: ${s.topSong}` : ""}`
    : `${num(s.songsPlayed)} songs played${s.duration ? `, ${s.duration} on stage` : ""}`;
  return shell(head + hero + grid + top + rating + foot, pre, "Your LiveQue gig recap");
}

function recapText(name: string, s: Record<string, unknown>): string {
  const lines = [
    `That's a wrap${name ? ", " + name : ""}.`,
    String(s.gigDate || ""),
    "",
    `Tips collected: ${money(s.tipsTotal)}`,
    `Songs played:   ${num(s.songsPlayed)}`,
    `Tips:           ${num(s.tipsCount)}`,
    `Requests:       ${num(s.requests)}`,
    `Set length:     ${s.duration || "-"}`,
  ];
  if (s.topSong) lines.push(`Crowd favorite: ${s.topSong}`);
  if (Number(s.ratingCount) > 0) {
    const rc = Number(s.ratingCount);
    lines.push(`Rating:         ${s.ratingAvg} average from ${rc} rating${rc === 1 ? "" : "s"}`);
  }
  lines.push("", `See all your gigs: ${SITE}`, "",
    "Nicely done. Your queue and tips reset for next time - break a leg out there.",
    "", "- Isaac & Glen, LiveQue", "", "--", "Sent by LiveQue - getliveque.com");
  return lines.join("\n");
}

// -- Send ---------------------------------------------------------------
async function sendResend(to: string, subject: string, html: string, text: string, listUnsub: boolean) {
  const payload: Record<string, unknown> = { from: EMAIL_FROM, to: [to], subject, html, text };
  // getliveque.com has no inbound MX, so a reply to the From address bounces.
  // Reply-To points somewhere a human actually reads.
  if (EMAIL_REPLY_TO) payload.reply_to = [EMAIL_REPLY_TO];
  // Password resets and the welcome are exempt from unsubscribe requirements; a
  // recurring stats digest is list-like, and a performer who doesn't want it
  // will otherwise hit "spam" -- which lands on the same domain reputation the
  // password resets depend on.
  if (listUnsub && EMAIL_REPLY_TO) {
    payload.headers = { "List-Unsubscribe": `<mailto:${EMAIL_REPLY_TO}?subject=unsubscribe>` };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Resend error");
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const type = body?.type;
    const name = typeof body?.name === "string" ? body.name.slice(0, 80) : "";

    // Recipient resolution is the security boundary. A browser caller never gets
    // to choose it; only the sweeper, holding the shared secret, does.
    let to: string;
    const internal = req.headers.get("x-internal-secret") || "";
    if (SWEEP_SECRET && internal && internal === SWEEP_SECRET) {
      const requested = typeof body?.to === "string" ? body.to.trim() : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requested)) throw new Error("Invalid recipient");
      to = requested;
    } else {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!token) throw new Error("Missing auth");
      const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user?.email) throw new Error("Invalid auth");
      to = userData.user.email;
    }

    let subject = "", html = "", text = "", unsub = false;
    if (type === "welcome") {
      subject = "Welcome to LiveQue";
      html = welcomeHtml(name);
      text = welcomeText(name);
    } else if (type === "recap") {
      const stats = (body?.stats || {}) as Record<string, unknown>;
      subject = "Your LiveQue gig recap";
      html = recapHtml(name, stats);
      text = recapText(name, stats);
      unsub = true;
    } else {
      throw new Error("Unknown email type");
    }

    const result = await sendResend(to, subject, html, text, unsub);
    return new Response(JSON.stringify({ ok: true, id: result?.id || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err as Error).message || err) }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
