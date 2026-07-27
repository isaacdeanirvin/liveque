#!/usr/bin/env python3
"""
Brand marks for Stripe Connect branding (and anywhere else a clean logo is needed).

  brand-icon.png   512x512  square app icon: teal rounded tile, white Q
  brand-logo.png   ~900x240 horizontal lockup: the tile + "LiveQue" wordmark

Drawn oversized and downsampled so edges stay crisp at small sizes. Same teal and
Inter as the printed cards, so every surface reads as one brand.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "assets")   # liveque/assets

TEAL = (23, 183, 174)       # #17B7AE — the accent used on the Stripe branding
INK  = (14, 17, 22)         # near-black wordmark, reads on light surfaces
WHITE = (255, 255, 255)

SS = 4  # supersample factor


def font(name, px):
    return ImageFont.truetype(os.path.join(FONTS, name), px)


def tile(size, radius_frac=0.22, glyph="Q", glyph_frac=0.62, glyph_dy_frac=0.03):
    """Teal rounded square with a centered white glyph."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_frac), fill=TEAL)
    f = font("Inter-Bold.ttf", int(s * glyph_frac))
    d.text((s / 2, s / 2 + s * glyph_dy_frac), glyph, font=f, fill=WHITE, anchor="mm")
    return img.resize((size, size), Image.LANCZOS)


def icon():
    tile(512).save(os.path.join(OUT, "brand-icon.png"))


def logo():
    """Horizontal lockup: tile + 'LiveQue' on transparent."""
    H = 300
    tile_px = 212
    gap = 52
    pad_l = 30
    f = font("Inter-Bold.ttf", 190 * SS)

    # measure wordmark
    tmp = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    word = "LiveQue"
    bbox = tmp.textbbox((0, 0), word, font=f)
    w_word = (bbox[2] - bbox[0]) // SS
    total_w = pad_l + tile_px + gap + w_word + 24

    img = Image.new("RGBA", (total_w * SS, H * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # tile, vertically centered
    t = tile(tile_px).resize((tile_px * SS, tile_px * SS), Image.LANCZOS)
    img.alpha_composite(t, (pad_l * SS, ((H - tile_px) // 2) * SS))
    # wordmark, baseline-aligned to visual center
    x = (pad_l + tile_px + gap) * SS
    d.text((x, H * SS / 2), word, font=f, fill=INK, anchor="lm")
    img.resize((total_w, H), Image.LANCZOS).save(os.path.join(OUT, "brand-logo.png"))


def main():
    os.makedirs(OUT, exist_ok=True)
    icon()
    logo()
    for n in ["brand-icon.png", "brand-logo.png"]:
        p = os.path.join(OUT, n)
        im = Image.open(p)
        print(f"  {n:16} {im.size[0]}x{im.size[1]}  {os.path.getsize(p):,} bytes")


if __name__ == "__main__":
    main()
