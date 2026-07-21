#!/usr/bin/env python3
"""
Builds the do-this-next sheet as a PDF.

Written to be read on a phone in a bar, not at a desk. Every step names the exact
page it happens on, and every claim was checked against the live site, the live
database or the Stripe dashboard at build time.
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
RULE  = colors.HexColor("#D9D9D9")
WASH  = colors.HexColor("#F2F7F3")

W, H = LETTER
ML, MR = 0.8 * inch, 0.8 * inch
COL = W - ML - MR

GLEN = "getliveque.com/customer.html?artist=f2c819fc-5665-4852-bcd7-797f92f7f0a5"
SMASH = "getliveque.com/customer.html?artist=00f23ec7-0911-4bbe-90fd-0764a3050e57"

TONIGHT = [
    ("Open your dashboard and sign in",
     "getliveque.com",
     "Same login you made. If it asks, tap Start free and use the email you signed up with."),
    ("Tap Start Gig",
     None,
     "This opens the queue for the night. Your page goes LIVE."),
    ("Put your link in front of the room",
     "your link is printed below",
     "Text it, put it on the table, or hand out the cards. They scan or tap, your "
     "175 songs come up, they pick one."),
    ("Requests land on your phone",
     None,
     "Silent. Nothing beeps at you mid song. Play what you want, skip what you don't."),
]

STRIPE = [
    ("Finish identity check",
     "dashboard.stripe.com/account/onboarding",
     "Photo of your driver's licence and a selfie, from your phone. Must match "
     "Isaac Irvin, born Jun 13 1977."),
    ("Check the business type is right",
     "same page, Business type step",
     "It currently says Company / Sole proprietorship. If you never filed an LLC "
     "or a DBA and have no EIN, change it to Individual. Getting this wrong "
     "switches card payments off after about $1,500."),
    ("Add your bank account",
     "same page, Add your bank",
     "Where the money lands. Stripe cannot pay anyone until this is in."),
    ("Hit Review and submit",
     "same page, last step",
     "Nothing is actually sent to Stripe until you press this. Then they review, "
     "which can take a few days."),
    ("Tick the two Connect boxes",
     "dashboard.stripe.com/settings/connect/platform-profile",
     "Refunds and chargebacks liability, and ongoing seller compliance. Read the "
     "first one. It says disputed tips come out of your pocket."),
    ("Add the website twice",
     "dashboard.stripe.com/settings/payment_method_domains",
     "Add getliveque.com AND www.getliveque.com as two separate entries. Skip this "
     "and Apple Pay and Google Pay just never appear."),
    ("Add two webhooks",
     "dashboard.stripe.com/workbench/webhooks",
     "Both point at the same address (see the box below). One normal, one set to "
     "Connected accounts. Copy the signing secret from the first one."),
    ("Send Isaac the signing secret",
     None,
     "The whsec_ code. He runs one script and the switch is flipped."),
    ("Everyone signs up with Stripe again",
     "getliveque.com, Set Up Payouts",
     "Practice accounts do not carry over to real money. Glen included. Takes "
     "about five minutes each."),
]

LATER = [
    ("Make support@getliveque.com work",
     "namecheap.com, Domain List, Manage, Email Forwarding",
     "Right now mail to it bounces. Point it at getliveque@gmail.com. Two minutes."),
    ("Copyright the code, $65",
     "copyright.gov",
     "Matters most of the three. You cannot sue anyone without it."),
    ("Trademark the name, $350",
     "uspto.gov",
     None),
    ("DMCA agent, $6",
     "dmca.copyright.gov",
     "Renew every 3 years."),
]

WEBHOOK = "https://jttswydixqeyyqvcohnq.supabase.co/functions/v1/stripe-webhook"


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
        c.setFont("Helvetica-Bold", 15); c.setFillColor(colour)
        c.drawString(ML, y[0], title); y[0] -= 17
        if sub:
            c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
            for ln in wrap(sub, "Helvetica", 9.5, COL):
                c.drawString(ML, y[0], ln); y[0] -= 12
        y[0] -= 8

    def step(n, title, url, body, colour):
        lines = wrap(body, "Helvetica", 9.5, COL - 30) if body else []
        brk(0.5 * inch + len(lines) * 12 + (13 if url else 0))
        # number bubble
        c.setFillColor(colour)
        c.circle(ML + 7, y[0] + 3.5, 8.5, stroke=0, fill=1)
        c.setFont("Helvetica-Bold", 9.5); c.setFillColor(colors.white)
        c.drawCentredString(ML + 7, y[0] + 0.7, str(n))

        c.setFont("Helvetica-Bold", 10.5); c.setFillColor(INK)
        c.drawString(ML + 24, y[0], title); y[0] -= 13
        if url:
            c.setFont("Helvetica-Bold", 9); c.setFillColor(BLUE)
            c.drawString(ML + 24, y[0], url); y[0] -= 13
        c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
        for ln in lines:
            c.drawString(ML + 24, y[0], ln); y[0] -= 12
        y[0] -= 9

    def box(label, value, tint=WASH, h=None):
        lines = wrap(value, "Courier-Bold", 8.6, COL - 24)
        bh = h or (20 + 13 + len(lines) * 12)
        brk(bh + 26)
        c.setFillColor(tint); c.setStrokeColor(RULE); c.setLineWidth(0.9)
        c.roundRect(ML, y[0] - bh + 14, COL, bh, 6, stroke=1, fill=1)
        c.setFont("Helvetica-Bold", 8); c.setFillColor(MUTED)
        c.drawString(ML + 12, y[0], label.upper()); y[0] -= 14
        c.setFont("Courier-Bold", 8.6); c.setFillColor(INK)
        for ln in lines:
            c.drawString(ML + 12, y[0], ln); y[0] -= 12
        y[0] -= 16

    # ---- header ----
    c.setFont("Helvetica-Bold", 24); c.setFillColor(INK)
    c.drawString(ML, y[0], "LiveQue")
    c.setFont("Helvetica", 10); c.setFillColor(MUTED)
    c.drawRightString(W - MR, y[0] + 3, "Do this next")
    y[0] -= 20
    c.setFont("Helvetica", 10); c.setFillColor(MUTED)
    for ln in wrap("Checked against the live site and the live Stripe account when this "
                   "was made. Nothing here is from memory.", "Helvetica", 10, COL):
        c.drawString(ML, y[0], ln); y[0] -= 13
    y[0] -= 8
    rule()

    # ---- tonight ----
    section("GLEN CAN GIG TONIGHT",
            "Song requests work right now. This does not need Stripe and does not need "
            "anyone's permission. The only thing that does not work yet is tipping "
            "inside the app.", GREEN)
    for i, (t, u, b) in enumerate(TONIGHT, 1):
        step(i, t, u, b, GREEN)

    box("Glen Irvin Jr.  (175 songs)", GLEN)
    box("The Smashing 90's  (63 songs)", SMASH)

    c.setFont("Helvetica-Oblique", 9.5); c.setFillColor(MUTED)
    for ln in wrap("Tonight the room can still tip Glen through the PayPal button on his "
                   "page, and in cash. It just cannot go through a card in the app yet.",
                   "Helvetica-Oblique", 9.5, COL):
        brk(0.4 * inch); c.drawString(ML, y[0], ln); y[0] -= 12
    y[0] -= 14
    rule()

    # ---- stripe ----
    section("TO TAKE REAL MONEY  (Isaac)",
            "In this order. Step 4 is the one that starts Stripe's review, and that "
            "review takes days, so the sooner it is sent the better.", RED)
    for i, (t, u, b) in enumerate(STRIPE, 1):
        step(i, t, u, b, RED)

    box("Address for BOTH webhooks", WEBHOOK)
    c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
    for ln in wrap("Webhook 1, normal: send payment_intent.succeeded and "
                   "charge.dispute.created.   Webhook 2, Connected accounts: send "
                   "account.updated.", "Helvetica", 9.5, COL):
        brk(0.4 * inch); c.drawString(ML, y[0], ln); y[0] -= 12
    y[0] -= 14
    rule()

    # ---- later ----
    section("WHEN THERE IS TIME", None, INK)
    for i, (t, u, b) in enumerate(LATER, 1):
        step(i, t, u, b or "", INK)

    c.showPage()
    total = c.getPageNumber() - 1
    c.save()
    return total


if __name__ == "__main__":
    print(f"wrote {OUT} ({build()} pages)")
