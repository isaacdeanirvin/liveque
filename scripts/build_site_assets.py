#!/usr/bin/env python3
"""
Builds the share card and favicon.

The repo had no image assets at all, which meant every link a performer shared
previewed as bare text titled "LiveQue - Admin Dashboard", and the browser tab
showed a blank page icon. Sharing is the growth mechanic, so the preview is not
decoration.

Deliberately reuses the business card's visual language, since that artwork is
already approved and printed: #080808 ground, Inter, one teal rule.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
FONTS = os.path.join(REPO, "cards", "print", "fonts")
OUT = os.path.join(REPO, "assets")

BG = (8, 8, 8)
INK = (255, 255, 255)
TEAL = (78, 205, 196)
DIM = (150, 150, 150)
BODY = (178, 178, 178)


def font(name, px):
    return ImageFont.truetype(os.path.join(FONTS, name), px)


def tracked(d, xy, text, f, fill, track=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + track
    return x


def share_card():
    """1200x630 - the size Open Graph and Twitter both read."""
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    M = 84

    f_kick = font("Inter-SemiBold.ttf", 21)
    f_hook = font("Inter-Bold.ttf", 78)
    f_body = font("Inter-Regular.ttf", 30)
    f_site = font("Inter-Bold.ttf", 31)

    y = M
    tracked(d, (M, y), "LIVE SONG REQUESTS & TIPS", f_kick, DIM, track=4.2)
    y += 62

    for line in ["Your tip jar", "takes cards now."]:
        d.text((M, y), line, font=f_hook, fill=INK)
        y += 92

    y += 26
    d.rectangle([M, y, M + 96, y + 5], fill=TEAL)
    y += 46

    for line in ["Your crowd requests songs and tips you from their",
                 "phone. It lands in your bank. We take 0%."]:
        d.text((M, y), line, font=f_body, fill=BODY)
        y += 43

    d.text((M, H - M - 30), "getliveque.com", font=f_site, fill=TEAL)
    return img


def favicon():
    """Rendered large and downsampled, so the glyph stays clean at 16px.

    Teal ground rather than the brand black: a near-black icon disappears into a
    dark browser tab strip, which is where this is actually seen.
    """
    S = 512
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=112, fill=TEAL)
    f = font("Inter-Bold.ttf", 330)
    d.text((S / 2, S / 2 + 14), "Q", font=f, fill=BG, anchor="mm")
    return img


def main():
    os.makedirs(OUT, exist_ok=True)

    card = share_card()
    card.save(os.path.join(OUT, "share.png"), optimize=True)
    card.resize((600, 315), Image.LANCZOS).save(
        os.path.join(OUT, "share-preview.png"), optimize=True)

    ico = favicon()
    ico.save(os.path.join(OUT, "favicon.png"), optimize=True)
    ico.resize((180, 180), Image.LANCZOS).save(
        os.path.join(OUT, "apple-touch-icon.png"), optimize=True)
    ico.save(os.path.join(OUT, "favicon.ico"),
             sizes=[(16, 16), (32, 32), (48, 48)])

    for n in ["share.png", "favicon.png", "apple-touch-icon.png", "favicon.ico"]:
        p = os.path.join(OUT, n)
        print(f"  {n:22} {os.path.getsize(p):>7,} bytes")


if __name__ == "__main__":
    main()
