// liveque-email — transactional email via Resend (welcome + gig recap).
//
// THIS IS THE ONLY PLACE LIVEQUE EMAIL TEMPLATES LIVE. gig-recap-sweeper used to
// carry its own copy of recapHtml() and the two drifted apart (differing closer
// and footer copy), so the auto-sent recap — the one most performers actually
// get, since forgetting to hit End Gig is the norm — did not match the manual
// one. The sweeper calls this function now. Do not reintroduce a second copy.
//
// WHY THESE EMAILS ARE LIGHT WHEN THE APP IS DARK:
// Gmail's iOS/Android apps and classic Outlook on Windows force-invert every
// message for dark-mode users, and ignore prefers-color-scheme while doing it.
// A dark email arrives light for those users and stays dark in Apple Mail and
// Yahoo — the same email, two opposite looks, no override available. So the
// canvas is light and the brand is carried where we DO control it: the #12433a
// header band, the dark hero stat tile, Georgia numerals, teal and gold accents.
//
// Security — two callers, two auth modes:
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

// ── Palette ────────────────────────────────────────────────────────────
// Never pure #ffffff or #000000 — Apple Mail's inversion heuristic keys on the
// exact values, so off-white and near-black dodge it outright.
const C = {
  page: "#f4f5f7",
  card: "#fffffe",
  ink: "#101014",
  body: "#3c3c46",
  muted: "#667085",
  line: "#e4e6ec",
  band: "#12433a",       // the LiveQue header band, same as every doc page
  bandTo: "#0f3a32",
  teal: "#4ecdc4",       // button fill
  tealInk: "#06251f",    // text ON teal — never white
  gold: "#ffd700",       // gold only ever sits on the dark hero tile
  // Accessible ink versions of the dashboard's stat colours. The raw teal/gold
  // fail WCAG on a light card, so labels use darkened variants (all ≥4.5:1).
  tealText: "#0d5f55",
  goldText: "#8a6a00",
  coralText: "#b3373c",
};

// Georgia for numerals: web-safe, so no webfont, and it reads as designed
// rather than default. Sans everywhere else.
const NUM = "Georgia,'Times New Roman',Times,serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

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
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${esc(title)}</title>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<!--[if mso]><style>* { font-family: 'Segoe UI', Arial, Helvetica, sans-serif !important; } .num { font-family: Georgia, serif !important; }</style><![endif]-->
<style>
  table { border-collapse:collapse; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  td { mso-line-height-rule:exactly; }
  img { border:0; display:block; -ms-interpolation-mode:bicubic; }
  body { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  h1 { margin:0 0 14px; font-size:26px; line-height:1.25; font-weight:700; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; font-size:inherit !important; font-family:inherit !important; font-weight:inherit !important; line-height:inherit !important; }
</style>
</head>
<body class="body" style="margin:0; padding:0; background-color:${C.page};">
<div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:${C.page}; opacity:0;">${esc(preheader)}${PREHEAD_PAD}</div>
<div role="article" aria-roledescription="email" aria-label="${esc(title)}" lang="en" dir="ltr" style="font-family:${SANS}; font-size:medium; font-size:max(16px,1rem);">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.page};">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:${C.card}; border-radius:16px; overflow:hidden; border:1px solid ${C.line};">
      <tr><td align="center" style="padding:26px 32px; background:linear-gradient(135deg,${C.band},${C.bandTo}); background-color:${C.band};">
        <div style="font-size:26px; font-weight:700; color:#fffffe; letter-spacing:-0.5px; font-family:${SANS};">LiveQue<span style="font-size:11px; color:${C.teal}; vertical-align:super;">TM</span></div>
        <div style="font-size:13px; color:#9fd8d1; margin-top:4px; font-family:${SANS};">Live song requests &amp; tipping for musicians</div>
      </td></tr>
      ${inner}
      <tr><td style="padding:22px 32px; border-top:1px solid ${C.line}; font-size:12px; line-height:1.6; color:${C.muted}; font-family:${SANS};">
        Sent by LiveQue &middot; <a href="${SITE}" style="color:${C.tealText};">getliveque.com</a><br />
        Reply to this email with any feedback &mdash; we read every one.
      </td></tr>
    </table>
  </td></tr>
</table>
</div>
</body>
</html>`;
}

// ── Tiles ──────────────────────────────────────────────────────────────
// The hero is the one dark tile on a light page. That single inversion carries
// the hierarchy on its own — the old email painted five numbers the same gold
// and nothing led.
function heroTile(value: string, label: string, color: string): string {
  return `<tr><td style="padding:0 32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.band}; border-radius:14px;">
      <tr><td align="center" style="padding:26px 20px;">
        <div style="font-size:11px; color:#9fd8d1; text-transform:uppercase; letter-spacing:1.5px; font-family:${SANS};">${esc(label)}</div>
        <div class="num" style="font-family:${NUM}; font-size:44px; font-weight:700; color:${color}; line-height:1.1; letter-spacing:-0.02em; margin-top:8px; white-space:nowrap;">${esc(value)}</div>
      </td></tr>
    </table>
  </td></tr>`;
}

// Fluid-hybrid: inline-block + max-width so the tiles stack on narrow screens
// with no media query (Gmail's apps honour neither), plus an MSO ghost table
// because the Word engine ignores max-width on a div.
function statTile(value: string, label: string, labelColor: string): string {
  // The inner div supplies the gutter: font-size:0 on the row kills the natural
  // whitespace between inline-blocks, and padding on the outer div would fight
  // width:100% + max-width.
  return `<div style="display:inline-block; width:100%; max-width:264px; vertical-align:top; font-size:16px;">
    <div style="padding:0 5px 10px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f8fa; border:1px solid ${C.line}; border-radius:12px;">
        <tr><td align="center" style="padding:18px 12px;">
          <div class="num" style="font-family:${NUM}; font-size:30px; font-weight:700; color:${C.ink}; line-height:1.1; letter-spacing:-0.02em; white-space:nowrap;">${esc(value)}</div>
          <div style="font-size:10px; color:${labelColor}; text-transform:uppercase; letter-spacing:1px; margin-top:8px; font-family:${SANS}; font-weight:600;">${esc(label)}</div>
        </td></tr>
      </table>
    </div>
  </div>`;
}

function tileRow(a: string, b: string): string {
  return `<tr><td style="padding:0 27px 0;">
    <div style="text-align:center; font-size:0;">
      <!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="268" valign="top"><![endif]-->
      ${a}
      <!--[if mso]></td><td width="268" valign="top"><![endif]-->
      ${b}
      <!--[if mso]></td></tr></table><![endif]-->
    </div>
  </td></tr>`;
}

// VML so classic Outlook gets a real rounded button instead of bare link text.
function ctaButton(href: string, text: string): string {
  return `<!--[if mso]>
  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="25%" stroke="f" fillcolor="${C.teal}">
    <w:anchorlock/><center style="color:${C.tealInk};font-family:'Segoe UI',Arial,sans-serif;font-size:15px;font-weight:700;">${esc(text)}</center>
  </v:roundrect>
  <![endif]-->
  <!--[if !mso]><!-- -->
  <a href="${href}" style="background-color:${C.teal}; border-radius:12px; color:${C.tealInk}; display:inline-block; font-family:${SANS}; font-size:15px; font-weight:700; line-height:48px; text-align:center; text-decoration:none; width:260px; mso-hide:all;">${esc(text)}</a>
  <!--<![endif]-->`;
}

// ── Welcome ────────────────────────────────────────────────────────────
function welcomeHtml(name: string): string {
  const hi = name ? `Welcome to LiveQue, ${esc(name)}` : "Welcome to LiveQue";
  const inner = `<tr><td style="padding:32px 32px 6px;">
    <h1 style="font-family:${NUM}; color:${C.ink};">${hi}</h1>
    <p style="margin:0 0 14px; font-size:16px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      We're <b style="color:${C.ink};">Isaac &amp; Glen Irvin</b> &mdash; two brothers who play out, same as you.
      We built LiveQue because we wanted a better way to connect a room to the person on stage:
      let people <b style="color:${C.ink};">request songs</b>, <b style="color:${C.ink};">tip to bump their pick</b>,
      and let you keep every cent of it.
    </p>
    <p style="margin:0 0 26px; font-size:16px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      You're all set. Add your songs, put your QR code on the tables, and start your first gig whenever you're ready.
    </p>
  </td></tr>
  <tr><td align="center" style="padding:0 32px 28px;">${ctaButton(SITE, "Open your dashboard")}</td></tr>
  <tr><td style="padding:0 32px 30px;">
    <p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      We'd genuinely love your feedback &mdash; tell us what you love and what we can make better. Just reply to this email.
    </p>
    <p style="margin:0; font-size:15px; line-height:1.6; color:${C.body}; font-family:${SANS};">
      Thanks for playing with us,<br /><b style="color:${C.ink};">Isaac &amp; Glen Irvin</b>
    </p>
  </td></tr>`;
  return shell(inner, "You're set up. Add your songs, print your QR code, and start your first gig.", "Welcome to LiveQue");
}

function welcomeText(name: string): string {
  return `${name ? `Welcome to LiveQue, ${name}` : "Welcome to LiveQue"}

We're Isaac & Glen Irvin - two brothers who play out, same as you. We built
LiveQue because we wanted a better way to connect a room to the person on
stage: let people request songs, tip to bump their pick, and let you keep
every cent of it.

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

// ── Recap ──────────────────────────────────────────────────────────────
function recapHtml(name: string, s: Record<string, unknown>): string {
  const tips = money(s.tipsTotal);
  const rc = Number(s.ratingCount) || 0;
  const dur = s.duration ? String(s.duration) : "—";
  const earned = Number(s.tipsTotal) > 0;

  // A night with no tips should not open with a giant $0.00. Lead with what
  // they did do; tips drop out of the grid rather than showing a zero twice.
  const hero = earned
    ? heroTile(tips, "Tips collected", C.gold)
    : heroTile(num(s.songsPlayed), "Songs played", "#fffffe");

  const grid = earned
    ? tileRow(statTile(num(s.songsPlayed), "Songs played", C.coralText), statTile(num(s.tipsCount), "Tips", C.goldText))
      + tileRow(statTile(num(s.requests), "Requests", C.tealText), statTile(dur, "Set length", C.muted))
    : tileRow(statTile(num(s.requests), "Requests", C.tealText), statTile(dur, "Set length", C.muted));

  const top = s.topSong
    ? `<tr><td style="padding:6px 32px 10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef8f7; border:1px solid #cfe9e6; border-radius:12px;">
          <tr><td style="padding:16px 18px;">
            <div style="font-size:10px; color:${C.tealText}; text-transform:uppercase; letter-spacing:1.2px; font-weight:600; font-family:${SANS};">Crowd favorite</div>
            <div style="font-size:17px; font-weight:700; color:${C.ink}; margin-top:5px; font-family:${SANS};">${esc(s.topSong)}</div>
          </td></tr>
        </table>
      </td></tr>`
    : "";

  // U+2605/U+2606, not the emoji star — a text glyph inherits colour and size.
  // aria-hidden with a real numeric equivalent beside it, so it is not the only
  // way the rating is conveyed.
  const rating = rc > 0
    ? (() => {
        const r = Math.max(0, Math.min(5, Math.round(Number(s.ratingAvg) || 0)));
        const glyphs = "&#9733;".repeat(r) + "&#9734;".repeat(5 - r);
        return `<tr><td style="padding:6px 32px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fdf7e3; border:1px solid #f0e2b0; border-radius:12px;">
            <tr><td align="center" style="padding:16px 18px;">
              <div style="font-size:22px; color:${C.goldText}; letter-spacing:3px; line-height:1.2;" aria-hidden="true">${glyphs}</div>
              <div style="font-size:13px; color:${C.body}; margin-top:8px; font-family:${SANS};">${esc(s.ratingAvg)} average from ${rc} rating${rc === 1 ? "" : "s"}</div>
            </td></tr>
          </table>
        </td></tr>`;
      })()
    : "";

  const inner = `<tr><td style="padding:30px 32px 6px;">
      <div style="font-size:11px; color:${C.tealText}; text-transform:uppercase; letter-spacing:2.5px; font-weight:600; font-family:${SANS};">Your night</div>
      <h1 style="margin:8px 0 4px; font-family:${NUM}; color:${C.ink};">That's a wrap${name ? ", " + esc(name) : ""}.</h1>
      <div style="font-size:13px; color:${C.muted}; margin-bottom:20px; font-family:${SANS};">${esc(s.gigDate || "")}</div>
    </td></tr>
    ${hero}
    ${grid}
    ${top}
    ${rating}
    <tr><td align="center" style="padding:18px 32px 6px;">${ctaButton(SITE, "See all your gigs")}</td></tr>
    <tr><td style="padding:20px 32px 30px;">
      <p style="margin:0 0 14px; font-size:15px; line-height:1.6; color:${C.body}; font-family:${SANS};">
        Nicely done. Your queue and tips reset for next time &mdash; break a leg out there.
      </p>
      <p style="margin:0; font-size:15px; color:${C.muted}; font-family:${SANS};">&mdash; Isaac &amp; Glen, LiveQue</p>
    </td></tr>`;

  const pre = earned
    ? `${tips} in tips${s.songsPlayed ? `, ${num(s.songsPlayed)} songs played` : ""}${s.topSong ? `. Crowd favorite: ${s.topSong}` : ""}`
    : `${num(s.songsPlayed)} songs played${s.duration ? `, ${s.duration} on stage` : ""}`;
  return shell(inner, pre, "Your LiveQue gig recap");
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

// ── Send ───────────────────────────────────────────────────────────────
async function sendResend(to: string, subject: string, html: string, text: string, listUnsub: boolean) {
  const payload: Record<string, unknown> = { from: EMAIL_FROM, to: [to], subject, html, text };
  // getliveque.com has no inbound MX, so a reply to the From address bounces.
  // Reply-To points somewhere a human actually reads.
  if (EMAIL_REPLY_TO) payload.reply_to = [EMAIL_REPLY_TO];
  // Password resets and the welcome are exempt from unsubscribe requirements; a
  // recurring stats digest is list-like, and a performer who doesn't want it
  // will otherwise hit "spam" — which lands on the same domain reputation the
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
