#!/usr/bin/env python3
"""
Builds the do-this-next sheet as a PDF.

Written to be read on a phone, not at a desk. Every claim was checked against the
live site, the live database, or the live Stripe dashboard at build time.

Updated after the Stripe account was submitted: the whole verify/bank/submit block
is done, so this sheet now leads with what is finished and what is merely waiting,
then the future go-live steps for real card tipping.
"""
import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.pdfgen import canvas

OUT = os.path.expanduser("~/Downloads/LiveQue-Do-This-Next.pdf")

INK   = colors.HexColor("#111111")
MUTED = colors.HexColor("#5A5A5A")
GREEN = colors.HexColor("#12703A")
RED   = colors.HexColor("#B3261E")
BLUE  = colors.HexColor("#1A4FBF")
AMBER = colors.HexColor("#8A6A00")
RULE  = colors.HexColor("#D9D9D9")

W, H = LETTER
ML, MR = 0.8 * inch, 0.8 * inch
COL = W - ML - MR

GLEN = "getliveque.com/customer.html?artist=f2c819fc-5665-4852-bcd7-797f92f7f0a5"
SMASH = "getliveque.com/customer.html?artist=00f23ec7-0911-4bbe-90fd-0764a3050e57"
WEBHOOK = "https://jttswydixqeyyqvcohnq.supabase.co/functions/v1/stripe-webhook"

# Done today. Shown so the progress is visible, not to be acted on.
DONE = [
    ("Stripe account submitted", None,
     "Identity (your SSN + ID), bank (Wells Fargo), business type, and the whole "
     "form. Now in Stripe's normal 2-3 day review."),
    ("Cut Vennew loose", None,
     "Switched off the dead Vennew EIN so the account verifies on YOUR SSN, not a "
     "6-year-old company. Card-statement name fixed from WWW.VENNEW.COM to LIVEQUE."),
    ("App is live in beta", None,
     "Song requests are FREE right now. Fans tip through your own Venmo, PayPal, "
     "Cash App, or Apple Cash handles. No card processing in the app yet."),
    ("Site cleaned up for Stripe", None,
     "Real page title, share preview, refund policy, working contact. Killed three "
     "old pages that still advertised Venmo on the domain Stripe is reviewing."),
]

# Waiting on Stripe. Nothing to do.
WAITING = [
    ("Stripe review", "2-3 days",
     "Watch for the approval email. The account status page says 'no further "
     "action required' - you are not blocking anything."),
    ("One item Stripe is double-checking", "no action",
     "Your address, for a money-movement feature (Treasury) LiveQue does not use. "
     "It is 'in review' and the button is greyed out, so there is nothing to do. "
     "Only flag: if it ever changes to 'Action needed', it wants your address "
     "confirmed - a 30-second fix."),
]

# The moment Stripe approves. Tell me and I do these.
AFTER = [
    ("Rename VENNEW to LiveQue", "I do it",
     "The internal legal name still reads VENNEW. Cannot be changed mid-review "
     "without risking it. The moment you are approved, I rename it."),
    ("Fix the product description", "I do it",
     "Stripe currently has 'Find Musicians, Book them for any Event' - that "
     "describes a booking site, not LiveQue. I align it to what you actually do."),
]

# Only when you want REAL card tipping inside the app. Not needed for the beta.
GOLIVE = [
    ("Register the website with Apple/Google Pay", "dashboard",
     "Add getliveque.com AND www.getliveque.com as two separate entries under "
     "Payment method domains. Skip it and the wallet buttons never appear."),
    ("Two webhooks", "dashboard",
     "Both point at the address in the box below. One normal, one scoped to "
     "'Connected accounts'. Copy the signing secret from the first."),
    ("Finish the Connect platform profile", "dashboard",
     "Settings, Connect, Platform profile. Two liability acknowledgements. Read "
     "the chargeback one - disputed tips come out of your pocket at 0% margin."),
    ("Flip the switch", "Isaac sends me the whsec_, I run one script",
     "Swaps the test keys for live keys and turns card tipping on in the app. "
     "One word change in the code."),
    ("Everyone connects Stripe again", "5 min each",
     "Practice accounts do not carry to real money. Glen included."),
]

# Admin, any time.
LEGAL = [
    ("Get support email working", "namecheap.com",
     "Mail to getliveque@gmail.com works; support@getliveque.com bounces (no mail "
     "records). Namecheap, Domain List, Manage, Email Forwarding. Two minutes."),
    ("Copyright the code, $65", "copyright.gov",
     "Matters most of the three - you cannot sue anyone without it."),
    ("Trademark the name, $350", "uspto.gov", None),
    ("DMCA agent, $6", "dmca.copyright.gov", "Renew every 3 years."),
]


def build():
    c = canvas.Canvas(OUT, pagesize=LETTER)
    y = [H - 0.75 * inch]

    def wrap(text, font, size, width):
        c.setFont(font, size)
        words, lines, cur = text.split(), [], ""
        for w in words:
            t = (cur + " " + w).strip()
            if c.stringWidth(t, font, size) <= width:
                cur = t
            else:
                lines.append(cur); cur = w
        if cur:
            lines.append(cur)
        return lines

    def brk(need):
        if y[0] < need:
            c.showPage(); y[0] = H - 0.75 * inch

    def rule():
        c.setStrokeColor(RULE); c.setLineWidth(0.9)
        c.line(ML, y[0], W - MR, y[0]); y[0] -= 20

    def section(title, sub, colour):
        brk(1.5 * inch)
        c.setFont("Helvetica-Bold", 14); c.setFillColor(colour)
        c.drawString(ML, y[0], title); y[0] -= 16
        if sub:
            c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
            for ln in wrap(sub, "Helvetica", 9.5, COL):
                c.drawString(ML, y[0], ln); y[0] -= 12
        y[0] -= 8

    def item(title, meta, body, colour, check=False):
        lines = wrap(body, "Helvetica", 9.5, COL - 28) if body else []
        brk(0.5 * inch + len(lines) * 12)
        if check:
            # drawn checkmark
            c.setStrokeColor(colour); c.setLineWidth(1.8)
            c.line(ML + 1, y[0] + 3, ML + 5, y[0] - 1)
            c.line(ML + 5, y[0] - 1, ML + 12, y[0] + 8)
        else:
            c.setStrokeColor(colour); c.setLineWidth(1.3)
            c.rect(ML, y[0] - 2.5, 11, 11, stroke=1, fill=0)
        c.setFont("Helvetica-Bold", 10.5); c.setFillColor(INK)
        c.drawString(ML + 22, y[0], title)
        if meta:
            c.setFont("Helvetica", 8.5); c.setFillColor(MUTED)
            c.drawRightString(W - MR, y[0], meta)
        y[0] -= 14
        c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
        for ln in lines:
            c.drawString(ML + 22, y[0], ln); y[0] -= 12
        y[0] -= 9

    def box(label, value):
        lines = wrap(value, "Courier-Bold", 8.6, COL - 24)
        bh = 20 + 13 + len(lines) * 12
        brk(bh + 26)
        c.setFillColor(colors.HexColor("#F2F7F3")); c.setStrokeColor(RULE); c.setLineWidth(0.9)
        c.roundRect(ML, y[0] - bh + 14, COL, bh, 6, stroke=1, fill=1)
        c.setFont("Helvetica-Bold", 8); c.setFillColor(MUTED)
        c.drawString(ML + 12, y[0], label.upper()); y[0] -= 14
        c.setFont("Courier-Bold", 8.6); c.setFillColor(INK)
        for ln in lines:
            c.drawString(ML + 12, y[0], ln); y[0] -= 12
        y[0] -= 16

    # header
    c.setFont("Helvetica-Bold", 24); c.setFillColor(INK)
    c.drawString(ML, y[0], "LiveQue")
    c.setFont("Helvetica", 10); c.setFillColor(MUTED)
    c.drawRightString(W - MR, y[0] + 3, "Where things stand")
    y[0] -= 20
    c.setFont("Helvetica", 10); c.setFillColor(MUTED)
    for ln in wrap("Checked live when this was made. The Stripe account is submitted and "
                   "in review, so most of the hard part is behind you.",
                   "Helvetica", 10, COL):
        c.drawString(ML, y[0], ln); y[0] -= 13
    y[0] -= 8
    rule()

    section("DONE TODAY", None, GREEN)
    for t, m, b in DONE:
        item(t, m, b, GREEN, check=True)

    rule()
    section("WAITING ON STRIPE  (nothing to do)", None, AMBER)
    for t, m, b in WAITING:
        item(t, m, b, AMBER)

    rule()
    section("THE MOMENT STRIPE APPROVES  (ping me)", None, BLUE)
    for t, m, b in AFTER:
        item(t, m, b, BLUE)

    rule()
    section("ONLY WHEN YOU WANT CARD TIPPING IN THE APP",
            "Not needed for the free beta. This is the real-money go-live.", RED)
    for t, m, b in GOLIVE:
        item(t, m, b, RED)
    box("Address for BOTH webhooks", WEBHOOK)

    rule()
    section("ADMIN, ANY TIME", None, INK)
    for t, m, b in LEGAL:
        item(t, m, b, INK)

    rule()
    section("GLEN'S GIG LINKS  (works right now, free)", None, GREEN)
    box("Glen Irvin Jr.  -  175 songs", GLEN)
    box("The Smashing 90's  -  63 songs", SMASH)
    c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
    for ln in wrap("Sign in at getliveque.com, tap Start Gig, put the link on the table. "
                   "Fans request free and tip through the handles on your page.",
                   "Helvetica", 9.5, COL):
        brk(0.4 * inch); c.drawString(ML, y[0], ln); y[0] -= 12

    c.showPage()
    total = c.getPageNumber() - 1
    c.save()
    return total


if __name__ == "__main__":
    print(f"wrote {OUT} ({build()} pages)")
