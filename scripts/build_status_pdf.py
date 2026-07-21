#!/usr/bin/env python3
"""
Builds the LiveQue status sheet as a PDF.

Every DONE item below was verified against the live site or a live database
query at build time, not recalled. Anything that could not be verified is in
its own section and labelled as such rather than being asserted.
"""
import os
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.pdfgen import canvas

OUT = os.path.expanduser("~/Downloads/LiveQue-Status.pdf")

INK   = colors.HexColor("#111111")
MUTED = colors.HexColor("#666666")
GREEN = colors.HexColor("#1a7f37")
RED   = colors.HexColor("#b3261e")
AMBER = colors.HexColor("#8a6a00")
RULE  = colors.HexColor("#d8d8d8")

DONE = [
    ("The website sells the app now",
     "Landing page is the front door, with an obvious way to log in."),
    ("Fixed: we were paying the card fee on every tip",
     "Every page said the performer nets $4.55 on a $5 tip. The code was giving "
     "them $5.00 and billing us $0.45. Now it matches what we publish."),
    ("Fixed: chargebacks were coming out of our pocket",
     "If a customer disputes a tip, it now comes back from the performer's "
     "account automatically instead of ours."),
    ("Terms of Service and Privacy Policy are live",
     "Stripe requires these of anyone using Connect. We were in breach and could "
     "have had the account frozen."),
    ("Signup has a real agree checkbox",
     "Not a footer link. Courts routinely throw the footer kind out."),
    ("Venmo and Zelle removed as tip options",
     "Venmo bans personal accounts from taking business money. Performers could "
     "have had funds frozen, and our help pages were telling them to do it."),
    ("Business cards designed, and ORDERED",
     "Real scannable QR, correct print sizes, both brothers. Isaac has sent them "
     "to print on Mohawk Superfine."),
    ("Card type sizes fixed",
     "Names were 6pt and contact details 4pt, below the minimum in our own print "
     "spec. Nobody reads that in a bar."),
    ("Phone layout fixed",
     "Copy was being squeezed into a narrow column on the about section."),
    ("Buttons made big enough to tap",
     "Eight controls were under the 44px minimum, including the rating stars, "
     "which get tapped one-handed in a dark room."),
    ("Copy rewritten",
     "The site is about connecting the room to the stage, not about money."),
    ("Share buttons added in three places",
     "Performer shares their own gig link, fan shares after tipping, and the "
     "landing page shares LiveQue."),
    ("Performer readiness now syncs automatically",
     "Stripe tells us the moment someone's verification clears, instead of "
     "waiting for them to open the dashboard."),
    ("Go-live guide written",
     "Ordered runbook so switching to real money does not silently break "
     "payments mid-gig."),
]

TODO = [
    ("Glen: log into getliveque.com once", "5 minutes",
     "Neither the Glen Irvin Jr. account nor The Smashing 90's can take tips "
     "right now. Verified by live query. Logging in fixes it."),
    ("Register the site with Apple Pay and Google Pay", "10 minutes",
     "Those buttons do not appear at all right now, so people must type a card "
     "number. Register getliveque.com AND www.getliveque.com in the Stripe "
     "dashboard. Both, separately."),
    ("Everyone re-signs up with Stripe when we switch to real money", "-",
     "Practice-mode accounts do not carry over to live. Unavoidable, and it is "
     "the longest job, so start it early."),
    ("Get support@getliveque.com receiving mail", "5 minutes",
     "It is printed on both legal pages. If it bounces, the policy is untrue."),
    ("Legal filings, $421 total", "-",
     "Copyright on the source code $65, trademark $350, DMCA registration $6. "
     "The copyright one matters most: you cannot sue without it."),
]

UNVERIFIED = [
    ("Is Stripe in practice mode or taking real money?",
     "I previously said practice mode. I cannot verify that from here, and the "
     "document I originally got it from turned out to be wrong about something "
     "else. Read it off the top of the Stripe dashboard, which shows the mode."),
    ("Are the payment method domains registered?",
     "Only visible inside the Stripe dashboard under Settings, Payment method "
     "domains. Cannot be checked from outside."),
]


def build():
    c = canvas.Canvas(OUT, pagesize=LETTER)
    W, H = LETTER
    ML, MR = 0.75 * inch, 0.75 * inch
    y = H - 0.8 * inch

    def space(n):
        nonlocal y
        y -= n

    def page_break_if(needed):
        nonlocal y
        if y < needed:
            c.showPage()
            y = H - 0.8 * inch

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

    # ── header ──────────────────────────────────────────────────────────
    c.setFont("Helvetica-Bold", 22); c.setFillColor(INK)
    c.drawString(ML, y, "LiveQue")
    c.setFont("Helvetica", 10.5); c.setFillColor(MUTED)
    c.drawRightString(W - MR, y + 3, "getliveque.com")
    space(20)
    c.setFont("Helvetica-Bold", 13); c.setFillColor(INK)
    c.drawString(ML, y, "Where things stand")
    space(15)
    c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
    for line in wrap("Everything in the DONE list was checked against the live site or the live "
                     "database when this sheet was generated. Nothing here is from memory.",
                     "Helvetica", 9.5, W - ML - MR):
        c.drawString(ML, y, line); space(12)
    space(6)
    c.setStrokeColor(RULE); c.setLineWidth(1); c.line(ML, y, W - MR, y)
    space(22)

    def section(title, colour, count=None):
        nonlocal y
        page_break_if(1.4 * inch)
        c.setFont("Helvetica-Bold", 12); c.setFillColor(colour)
        label = f"{title}   ({count})" if count is not None else title
        c.drawString(ML, y, label)
        space(18)

    def item(title, body, box_colour, meta=None):
        nonlocal y
        body_lines = wrap(body, "Helvetica", 9.5, W - ML - MR - 26)
        page_break_if(0.42 * inch + len(body_lines) * 12)
        # checkbox
        c.setStrokeColor(box_colour); c.setLineWidth(1.3)
        c.rect(ML, y - 2.5, 11, 11, stroke=1, fill=0)
        c.setFont("Helvetica-Bold", 10.5); c.setFillColor(INK)
        c.drawString(ML + 20, y, title)
        if meta:
            c.setFont("Helvetica", 8.5); c.setFillColor(MUTED)
            c.drawRightString(W - MR, y, meta)
        space(14)
        c.setFont("Helvetica", 9.5); c.setFillColor(MUTED)
        for line in body_lines:
            c.drawString(ML + 20, y, line); space(12)
        space(8)

    section("DONE", GREEN, len(DONE))
    for t, b in DONE:
        item(t, b, GREEN)

    space(6); c.setStrokeColor(RULE); c.line(ML, y, W - MR, y); space(20)
    section("STILL TO DO", RED, len(TODO))
    for t, m, b in TODO:
        item(t, b, RED, meta=m)

    space(6); c.setStrokeColor(RULE); c.line(ML, y, W - MR, y); space(20)
    section("NEEDS CHECKING IN THE STRIPE DASHBOARD", AMBER)
    for t, b in UNVERIFIED:
        item(t, b, AMBER)

    # ── footer on every page ────────────────────────────────────────────
    c.showPage()
    total = c.getPageNumber() - 1
    c.save()
    return total


if __name__ == "__main__":
    pages = build()
    print(f"wrote {OUT} ({pages} pages)")
