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
from PIL import Image, ImageChops, ImageDraw, ImageFont

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

def tracked(draw, xy, text, f, fill, track=0, anchor="la"):
    """PIL has no letter-spacing, so draw glyph by glyph.

    anchor="ls" draws on the BASELINE rather than the top of the box, which is
    what lets two different type sizes line up across a column gap.
    """
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill, anchor=anchor)
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

def logo(width_px):
    """The FINAL G-Emit logo (white body, teal dot + radar arcs, outlined ™).

    logo-dark.png is rendered from the vector source (scratchpad marks_onair.py G)
    on the exact card ground #080808 at ~3500px, so a plain RGB paste is seamless
    and the LANCZOS downscale to card size stays crisp. Cropped to ink bounds so
    width_px is the true visible width.
    """
    im = Image.open(os.path.join(HERE, "logo-dark.png")).convert("RGB")
    im = im.crop(ImageChops.difference(im, Image.new("RGB", im.size, BG)).getbbox())
    h = max(1, int(round(width_px * im.size[1] / im.size[0])))
    return im.resize((int(width_px), h), Image.LANCZOS)

def front(p):
    img, d = new_card()
    f_kick = font("Inter-SemiBold.ttf", inch(0.097))
    f_hook = font("Inter-Bold.ttf", inch(0.255))
    f_name = font("Inter-Bold.ttf", inch(0.160))
    f_role = font("Inter-Medium.ttf", inch(0.104))
    f_meta = font("Inter-Regular.ttf", inch(0.118))

    y = SAFE + inch(0.02)
    tracked(d, (SAFE, y), "WHAT YOU HEAR ALL NIGHT", f_kick, (120, 120, 120), track=inch(0.019))

    # brand mark, top-right, optically balancing the kicker line
    lg = logo(inch(0.82))
    img.paste(lg, (BLEED_W - SAFE - lg.size[0], y - inch(0.01)))
    y += inch(0.155)

    for line in ["“Sorry, I don’t", "have cash.”"]:
        d.text((SAFE, y), line, font=f_hook, fill=INK)
        y += inch(0.275)

    ry = y + inch(0.055)
    d.rectangle([SAFE, ry, SAFE + inch(0.42), ry + inch(0.018)], fill=TEAL)

    # Identity block. Two shared BASELINES, so the name sits on exactly the same
    # line as the email and the role on the same line as the handle. Drawing at
    # PIL's default top-of-box anchor is what threw these out of alignment: an
    # 11.5pt name and an 8.5pt email have different ascents, so an equal y value
    # puts them on visibly different lines.
    # base2 sits far enough up that descenders stay inside the safe area
    base1 = BLEED_H - SAFE - inch(0.255)
    base2 = BLEED_H - SAFE - inch(0.042)
    right = BLEED_W - SAFE

    d.text((SAFE, base1), f"{p['first']} {p['last']}", font=f_name, fill=INK, anchor="ls")
    d.text((right, base1), p["email"], font=f_meta, fill=(185, 185, 185), anchor="rs")

    tracked(d, (SAFE, base2), "MUSICIAN", f_role, DIM, track=inch(0.019), anchor="ls")
    d.text((right, base2), p["ig"], font=f_meta, fill=(185, 185, 185), anchor="rs")
    return img

def back():
    img, d = new_card()
    f_kick = font("Inter-SemiBold.ttf", inch(0.097))
    f_hook = font("Inter-Bold.ttf", inch(0.170))
    f_body = font("Inter-Regular.ttf", inch(0.115))

    # QR: above the 0.8in floor in the spec, with a true 4-module quiet zone
    code_px = inch(0.86)
    qr, mod, n = qr_image(code_px)
    quiet = mod * 4
    panel = qr.size[0] + quiet * 2
    px = BLEED_W - SAFE - panel
    py = BLEED_H - SAFE - panel
    # PIL rectangles are inclusive of the end pixel: [px, px+panel] paints
    # panel+1 columns, poking 1px over the safe boundary. -1 keeps it exact.
    d.rectangle([px, py, px + panel - 1, py + panel - 1], fill=(255, 255, 255))
    img.paste(qr, (px + quiet, py + quiet))

    col_w = px - SAFE - inch(0.16)

    y = SAFE
    tracked(d, (SAFE, y), "WHAT TO SAY BACK", f_kick, (120, 120, 120), track=inch(0.019))
    y += inch(0.155)

    # "takes cards" is table stakes (Venmo does that); requests are the thing
    # nobody else takes - the tip visibly picks a song and jumps the queue.
    for line in ["Your tip jar", "takes requests now."]:
        d.text((SAFE, y), line, font=f_hook, fill=INK)
        y += inch(0.19)

    y += inch(0.05)
    body = ("They scan, ask for a song, and tip from their phone. It lands in "
            "your bank. We take nothing and nobody installs an app.")
    for line in wrap(d, body, f_body, col_w):
        d.text((SAFE, y), line, font=f_body, fill=(178, 178, 178))
        y += inch(0.152)

    # sign-off lockup: logo bottom-left, URL beside it on the wordmark baseline.
    # Side-by-side (not stacked) because the 4-line body leaves ~0.55in down
    # here; stacking pushed the arcs into the body's descenders.
    lg = logo(inch(1.15))
    lg_y = BLEED_H - SAFE - inch(0.02) - lg.size[1]
    img.paste(lg, (SAFE, lg_y))
    d.text((SAFE + lg.size[0] + inch(0.14), lg_y + lg.size[1] - inch(0.005)),
           "getliveque.com", font=font("Inter-Regular.ttf", inch(0.095)),
           fill=(150, 150, 150), anchor="ls")
    return img

def with_guides(img):
    g = img.copy()
    d = ImageDraw.Draw(g)
    d.rectangle([BLEED, BLEED, BLEED_W - BLEED - 1, BLEED_H - BLEED - 1], outline=(255, 60, 60), width=4)
    d.rectangle([SAFE, SAFE, BLEED_W - SAFE - 1, BLEED_H - SAFE - 1], outline=(70, 160, 255), width=4)
    return g

def verify_qr(img):
    """Decode the QR back off the rendered art, not off the source string.

    Rendering is where a QR actually dies: wrong module rounding, a quiet zone
    eaten by the panel edge, a resample that blurs the timing pattern. The only
    honest check is to read the pixels a scanner would read.
    """
    try:
        import cv2, numpy as np
    except ImportError:
        return None
    val, _, _ = cv2.QRCodeDetector().detectAndDecode(np.array(img.convert("RGB"))[:, :, ::-1])
    return val or ""


def main():
    out = os.path.join(HERE, "output")
    os.makedirs(out, exist_ok=True)
    made = []
    sheets = []

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

        # Most printers want ONE file per card, page 1 front, page 2 back. Upload
        # this rather than the singles unless the order form asks for two files.
        combo = os.path.join(out, f"LiveQue-{p['first'].title()}-Irvin-CARD.pdf")
        f.save(combo, "PDF", resolution=DPI, save_all=True, append_images=[b])
        sheets.append(combo)

    # All four artboards in one file, for a proof or a single combined upload.
    first = front(PEOPLE[0])
    rest = [back()] + [x for p in PEOPLE[1:] for x in (front(p), back())]
    first.save(os.path.join(out, "LiveQue-CARDS-ALL.pdf"), "PDF",
               resolution=DPI, save_all=True, append_images=rest)

    print(f"{DPI} DPI")
    print(f"bleed {BLEED_W}x{BLEED_H}px = 3.75x2.25in")
    print(f"trim  {TRIM_W}x{TRIM_H}px = 3.5x2.0in")

    decoded = verify_qr(back())
    if decoded is None:
        print("QR   : NOT VERIFIED (opencv missing) - do not order without a phone test")
    elif decoded == URL:
        print(f"QR   : decodes to {decoded}")
    else:
        raise SystemExit(f"QR FAILED: rendered code reads {decoded!r}, expected {URL!r}")

    print("\nupload these:")
    for s in sheets:
        print("  ", os.path.basename(s))

if __name__ == "__main__":
    main()
