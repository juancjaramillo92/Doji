#!/usr/bin/env python3
"""Turns the charm's art into the bytes the firmware draws, and the numbers
it draws them by.

The screen is drawn in RGB565, and nothing is decoded at boot or decompressed
into memory: every render is embedded as the bytes the screen takes, in LVGL's
native little-endian order, and drawn as it is.

From art/eugenia.png, 466 x 466, her glass on black:

  art/body.rgb565        GLASS_FRAMES renders of her, from stretched to
                         squashed about the bottom of her glass, keeping her
                         volume, each cut to the one patch every render fits
  art/glow.a8            the light inside her, an alpha the screen tints
  art/bubbles.argb8888   a bubble in each of GLASS_SIZES, drawn at every
                         quarter pixel GLASS_PHASES gives, so one gliding
                         slowly never steps
  main/art.c             that patch, the point she squashes about, each
                         render's squash, her outline at rest row by row, and
                         the bubbles' radii and sprite sides

GLASS_FRAMES, GLASS_SIZES and GLASS_PHASES are read out of main/glass.h, so
the renders and the firmware cannot disagree on how many there are.

    python3 charm/tools/art.py      # after changing a render in charm/art/
"""
import math
import pathlib
import re
from PIL import Image, ImageChops, ImageFilter

CHARM = pathlib.Path(__file__).resolve().parent.parent
ART, MAIN = CHARM / "art", CHARM / "main"
SIZE = 466

GLASS = (MAIN / "glass.h").read_text()
FRAMES, SIZES, PHASES = (int(re.search(rf"^#define GLASS_{n}\s+(\d+)", GLASS, re.M).group(1))
                         for n in ("FRAMES", "SIZES", "PHASES"))

# Each render's squash, as a share of her width: fine on the stretched side,
# where a breath lives, so a step moves her top under a pixel; coarse beyond,
# and on the squashed side, where only a wobble goes, and quickly.
SQUASH = (-0.06, -0.038, -0.02, -0.009, -0.0065, -0.0045, -0.003, -0.0015, 0, 0.006, 0.02, 0.04, 0.06)
EDGE = 24           # brighter than this, in any channel, is her glass
RADII = (2.6, 3.8, 5.5)
GLOW_IN, GLOW_SOFT = 50, 60   # how far inside her edge the light starts, and how soft it is
assert len(SQUASH) == FRAMES and list(SQUASH) == sorted(SQUASH) and 0 in SQUASH and len(RADII) == SIZES

im = Image.open(ART / "eugenia.png").convert("RGB")
assert im.size == (SIZE, SIZE), f"eugenia.png is {im.size}, not {SIZE} x {SIZE}"
red, green, blue = (band.point(lambda v: 255 if v > EDGE else 0) for band in im.split())
glass = ImageChops.lighter(ImageChops.lighter(red, green), blue)
mask = glass.load()

# Each row's longest unbroken run of glass, so the outline never takes in the
# notch where her two lobes meet at the bottom: a bubble kept inside it is in
# glass.
outline = []
for y in range(SIZE):
    runs, start = [], None
    for x in range(SIZE + 1):
        if x < SIZE and mask[x, y] and start is None:
            start = x
        elif (x == SIZE or not mask[x, y]) and start is not None:
            runs.append((start, x - 1))
            start = None
    outline.append(max(runs, key=lambda r: r[1] - r[0]) if runs else (0, -1))
rows = [y for y, (l, r) in enumerate(outline) if r >= l]
left, right = min(outline[y][0] for y in rows), max(outline[y][1] for y in rows)
top, bottom = rows[0], rows[-1]
anchor = ((left + right) / 2, bottom)

def scale(s):
    return 1 + s, 1 / (1 + s)

# The one patch every render fits, a pixel to spare.
xs, ys = [], []
for s in (SQUASH[0], SQUASH[-1]):
    sx, sy = scale(s)
    xs += [anchor[0] + (x - anchor[0]) * sx for x in (left, right + 1)]
    ys += [anchor[1] + (y - anchor[1]) * sy for y in (top, bottom + 1)]
x0, y0 = max(0, math.floor(min(xs)) - 1), max(0, math.floor(min(ys)) - 1)
x1, y1 = min(SIZE, math.ceil(max(xs)) + 1), min(SIZE, math.ceil(max(ys)) + 1)
w, h = x1 - x0, y1 - y0

def rgb565(image):
    px, out = image.tobytes(), bytearray()
    for i in range(0, len(px), 3):
        r, g, b = px[i], px[i + 1], px[i + 2]
        out += (((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)).to_bytes(2, "little")
    return out

body = bytearray()
for s in SQUASH:
    sx, sy = scale(s)
    # Each pixel of the patch, back to where it came from in the render; at
    # rest, the render itself.
    coeffs = (1 / sx, 0, anchor[0] + (x0 - anchor[0]) / sx, 0, 1 / sy, anchor[1] + (y0 - anchor[1]) / sy)
    body += rgb565(im.crop((x0, y0, x1, y1)) if s == 0 else
                   im.transform((w, h), Image.AFFINE, coeffs, Image.BICUBIC, fillcolor=(0, 0, 0)))
(ART / "body.rgb565").write_bytes(bytes(body))

# The light inside her: her glass drawn in from its edge and softened, falling
# off with the square so it gathers in her middle, and never past her edge.
inner = glass.filter(ImageFilter.MinFilter(2 * GLOW_IN + 1)).filter(ImageFilter.GaussianBlur(GLOW_SOFT))
peak = inner.getextrema()[1]
inner = ImageChops.multiply(inner.point(lambda v: round(255 * (v / peak) ** 2)), glass)
(ART / "glow.a8").write_bytes(inner.crop((x0, y0, x1, y1)).tobytes())

# A bubble: a faint body, a lighter rim and a highlight up and to the left,
# drawn eight times over each pixel and averaged.
RIM, BODY, SHINE = (0xcf, 0xee, 0xe0), (0xa8, 0xe6, 0xc8), (0xff, 0xff, 0xff)
SIDES = [2 * math.ceil(r) + 4 for r in RADII]

def bubble(r, side, fx, fy):
    out = bytearray()
    cx, cy = side / 2 + fx, side / 2 + fy
    for py in range(side):
        for px in range(side):
            a = [0.0, 0.0, 0.0, 0.0]
            for sy in range(8):
                for sx in range(8):
                    x, y = px + (sx + 0.5) / 8 - cx, py + (sy + 0.5) / 8 - cy
                    d = math.hypot(x, y)
                    hx, hy = x + 0.35 * r, y + 0.35 * r
                    if math.hypot(hx, hy) <= 0.3 * r + 0.5:
                        c, alpha = SHINE, 0.9
                    elif r - 1.2 <= d <= r:
                        c, alpha = RIM, 0.85
                    elif d < r:
                        c, alpha = BODY, 0.2
                    else:
                        continue
                    for i in range(3):
                        a[i] += c[i] * alpha
                    a[3] += alpha
            if a[3]:
                b, g, rr = (round(a[i] / a[3]) for i in (2, 1, 0))
                out += bytes((b, g, rr, round(255 * a[3] / 64)))
            else:
                out += bytes(4)
    return out

bubbles = bytearray()
for r, side in zip(RADII, SIDES):
    for py in range(PHASES):
        for px in range(PHASES):
            bubbles += bubble(r, side, px / PHASES, py / PHASES)
(ART / "bubbles.argb8888").write_bytes(bytes(bubbles))

def floats(values):
    return ", ".join(f"{v:.6f}f" for v in values)

rows_c = ",\n".join("    " + ", ".join(f"{{ {l}, {r} }}" for l, r in outline[y:y + 8]) for y in range(0, SIZE, 8))
(MAIN / "art.c").write_text(f"""/* Made by charm/tools/art.py from art/eugenia.png, with the renders it
   embeds: run it again rather than edit this. */
#include "glass.h"

const int16_t GLASS_CROP[4] = {{ {x0}, {y0}, {w}, {h} }};
const float GLASS_ANCHOR[2] = {{ {floats(anchor)} }};
const float GLASS_SQUASH[GLASS_FRAMES] = {{ {floats(SQUASH)} }};
const float GLASS_RADIUS[GLASS_SIZES] = {{ {floats(RADII)} }};
const uint8_t GLASS_SIDE[GLASS_SIZES] = {{ {", ".join(map(str, SIDES))} }};
const int16_t GLASS_OUTLINE[466][2] = {{
{rows_c},
}};
""")
