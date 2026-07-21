#!/usr/bin/env python3
"""
Builds print-ready LiveQue business cards.

Geometry follows docs/LiveQue_PrintSpec.md:
  trim  3.5 x 2.0 in
  bleed 3.75 x 2.25 in  (0.125 in per edge)
  safe  3.25 x 1.75 in  (0.125 in inset from trim)

Everything is drawn at 600 DPI because the card carries small type and a QR.
Type is Inter (SIL Open Font License), which unlike Segoe UI may be embedded
and outlined in a print file.

The QR is a real, decoded, error-correction-H code for https://getliveque.com,
sized above the 0.8 in floor in the print spec with a full 4-module quiet zone.
"""
import os
import segno
from PIL import Image, ImageDraw, ImageFont

DPI = 600
HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")

def inch(v):
    return int(round(v * DPI))

BLEED_W, BLEED_H = inch(3.75), inch(2.25)
BLEED = inch(0.125)                       # trim starts here
SAFE = BLEED + inch(0.125)                # safe area inset from trim
TRIM_W, TRIM_H = inch(3.5), inch(2.0)

INK = (255, 255, 255)
BG = (8, 8, 8)                            # #080808, sampled from the app
DIM = (150, 150, 150)
TEAL = (78, 205, 196)

URL = "https://getliveque.com"

PEOPLE = [
    dict(first="GLEN",  last="IRVIN", email="glenirvin@gmail.com",  ig="@irvspanish", n=1),
    dict(first="ISAAC", last="IRVIN", email="isaacirvin@gmail.com", ig="@isaacirvin", n=2),
]

def font(name, px):
    return ImageFont.truetype(os.path.join(FONTS, name), px)

def tracked(draw, xy, text, f, fill, track=0):
    """PIL has no letter-spacing. Draw glyph by glyph."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + track
    return x

def tracked_width(draw, text, f, track=0):
    return sum(draw.textlength(c, font=f) for c in text) + track * max(0, len(text) - 1)

def wrap(draw, text, f, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines

def qr_image(px_code):
    """Real QR, error correction H, no built-in border. Returns (img, module_px).

    Module size is rounded UP. Flooring quietly shrank the code below the size
    asked for: 0.86in of budget over 29 modules floored to 17px per module and
    printed at 0.822in. Rounding up holds the requested size.
    """
    qr = segno.make(URL, error="h", micro=False)
    matrix = [list(row) for row in qr.matrix]
    n = len(matrix)
    mod = max(1, -(-px_code // n))
    size = mod * n
    img = Image.new("RGB", (size, size), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for r, row in enumerate(matrix):
        for c, v in enumerate(row):
            if v:
                d.rectangle([c * mod, r * mod, c * mod + mod - 1, r * mod + mod - 1], fill=(0, 0, 0))
    return img, mod, n

def new_card():
    img = Image.new("RGB", (BLEED_W, BLEED_H), BG)
    return img, ImageDraw.Draw(img)

def front(p):
    img, d = new_card()
    f_kick = font("Inter-SemiBold.ttf", inch(0.097))
    f_hook = font("Inter-Bold.ttf", inch(0.255))
    f_name = font("Inter-Bold.ttf", inch(0.160))
    f_role = font("Inter-Medium.ttf", inch(0.104))
    f_meta = font("Inter-Regular.ttf", inch(0.118))

    y = SAFE + inch(0.02)
    tracked(d, (SAFE, y), "WHAT YOU HEAR ALL NIGHT", f_kick, (120, 120, 120), track=inch(0.019))
    y += inch(0.155)

    for line in ["“Sorry, I don’t", "have cash.”"]:
        d.text((SAFE, y), line, font=f_hook, fill=INK)
        y += inch(0.275)

    ry = y + inch(0.055)
    d.rectangle([SAFE, ry, SAFE + inch(0.42), ry + inch(0.018)], fill=TEAL)

    # identity block pinned to the bottom safe edge
    by = BLEED_H - SAFE - inch(0.40)
    d.text((SAFE, by), f"{p['first']} {p['last']}", font=f_name, fill=INK)
    tracked(d, (SAFE, by + inch(0.185)), "MUSICIAN", f_role, DIM, track=inch(0.019))

    right = BLEED_W - SAFE
    for i, line in enumerate([p["email"], p["ig"]]):
        w = d.textlength(line, font=f_meta)
        d.text((right - w, by + inch(0.055) + i * inch(0.145)), line, font=f_meta, fill=(185, 185, 185))
    return img

def back():
    img, d = new_card()
    f_kick = font("Inter-SemiBold.ttf", inch(0.097))
    f_hook = font("Inter-Bold.ttf", inch(0.170))
    f_body = font("Inter-Regular.ttf", inch(0.115))
    f_site = font("Inter-Bold.ttf", inch(0.132))

    # QR: above the 0.8in floor in the spec, with a true 4-module quiet zone
    code_px = inch(0.86)
    qr, mod, n = qr_image(code_px)
    quiet = mod * 4
    panel = qr.size[0] + quiet * 2
    px = BLEED_W - SAFE - panel
    py = BLEED_H - SAFE - panel
    d.rectangle([px, py, px + panel, py + panel], fill=(255, 255, 255))
    img.paste(qr, (px + quiet, py + quiet))

    col_w = px - SAFE - inch(0.16)

    y = SAFE
    tracked(d, (SAFE, y), "WHAT TO SAY BACK", f_kick, (120, 120, 120), track=inch(0.019))
    y += inch(0.155)

    for line in ["Your tip jar", "takes cards now."]:
        d.text((SAFE, y), line, font=f_hook, fill=INK)
        y += inch(0.19)

    y += inch(0.05)
    body = ("They scan, ask for a song, and tip from their phone. It lands in "
            "your bank. We take nothing and nobody installs an app.")
    for line in wrap(d, body, f_body, col_w):
        d.text((SAFE, y), line, font=f_body, fill=(178, 178, 178))
        y += inch(0.152)

    d.text((SAFE, BLEED_H - SAFE - inch(0.155)), "getliveque.com", font=f_site, fill=TEAL)
    return img

def with_guides(img):
    g = img.copy()
    d = ImageDraw.Draw(g)
    d.rectangle([BLEED, BLEED, BLEED_W - BLEED - 1, BLEED_H - BLEED - 1], outline=(255, 60, 60), width=4)
    d.rectangle([SAFE, SAFE, BLEED_W - SAFE - 1, BLEED_H - SAFE - 1], outline=(70, 160, 255), width=4)
    return g

def main():
    out = os.path.join(HERE, "output")
    os.makedirs(out, exist_ok=True)
    made = []
    for p in PEOPLE:
        f = front(p)
        b = back()
        for label, im in (("front", f), ("back", b)):
            stem = f"{p['n']}-{p['first'].lower()}-{label}"
            im.save(os.path.join(out, stem + ".png"), dpi=(DPI, DPI))
            im.save(os.path.join(out, stem + ".pdf"), "PDF", resolution=DPI)
            made.append(stem)
        with_guides(f).save(os.path.join(out, f"PROOF-{p['first'].lower()}-front.png"), dpi=(DPI, DPI))
        with_guides(b).save(os.path.join(out, f"PROOF-{p['first'].lower()}-back.png"), dpi=(DPI, DPI))

    print(f"{DPI} DPI")
    print(f"bleed {BLEED_W}x{BLEED_H}px = 3.75x2.25in")
    print(f"trim  {TRIM_W}x{TRIM_H}px = 3.5x2.0in")
    print("files:", len(made) * 2 + 4)
    for m in made:
        print("  ", m + ".png /", m + ".pdf")

if __name__ == "__main__":
    main()
