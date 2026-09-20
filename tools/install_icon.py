#!/usr/bin/env python3
"""Crop a Ludo icon candidate to its rounded square, knock out the white surround, export PWA sizes.

    python3 tools/install_icon.py [target_repo] [candidate_number]
"""
import pathlib
import sys

from PIL import Image, ImageDraw

SRC = pathlib.Path(__file__).resolve().parent.parent / "assets-src" / "icon"
target = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else SRC.parent.parent).resolve()
cand = int(sys.argv[2]) if len(sys.argv) > 2 else 3

img = Image.open(SRC / f"cand{cand:02d}.png").convert("RGBA")
# The surround is flat white: flood it from each corner, then crop to what is left.
for corner in [(0, 0), (img.width - 1, 0), (0, img.height - 1), (img.width - 1, img.height - 1)]:
    ImageDraw.floodfill(img, corner, (0, 0, 0, 0), thresh=60)
img = img.crop(img.getchannel("A").getbbox())
side = max(img.size)
square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))

out = target / "public"
for size, name in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png"), (32, "favicon.png")]:
    square.resize((size, size), Image.LANCZOS).save(out / name)
# Maskable icons get cropped to a circle by the OS: full-bleed background, art inside the safe zone.
bg = square.getpixel((side // 2, int(side * 0.04)))
mask = Image.new("RGBA", (512, 512), bg[:3] + (255,))
inner = square.resize((410, 410), Image.LANCZOS)
mask.paste(inner, (51, 51), inner)
mask.save(out / "icon-maskable-512.png")
print("icons ->", out)
