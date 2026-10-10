#!/usr/bin/env python3
"""Turns the charm's art into the bytes the firmware draws.

The screen is drawn in RGB565, so each character's 466 x 466 render becomes
434,312 bytes in LVGL's native little-endian order, embedded as it is: no
decoder runs at boot and nothing is decompressed into memory. The blush is a
small ARGB8888 image, a pink radial falloff the face draws over each cheek at
whatever strength the mood asks for.

    python3 charm/tools/art.py      # after changing a render in charm/art/
"""
import math
import pathlib
from PIL import Image

ART = pathlib.Path(__file__).resolve().parent.parent / "art"
SIZE = 466

for name in ("eugenia", "gladys"):
    im = Image.open(ART / f"{name}.png").convert("RGB")
    assert im.size == (SIZE, SIZE), f"{name}.png is {im.size}, not {SIZE} x {SIZE}"
    px, out = im.tobytes(), bytearray()
    for i in range(0, len(px), 3):
        r, g, b = px[i], px[i + 1], px[i + 2]
        out += (((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)).to_bytes(2, "little")
    (ART / f"{name}.rgb565").write_bytes(bytes(out))

# A cheek: 52 x 44, the playground's pink at full strength in the middle,
# falling to nothing at the edge. LVGL's ARGB8888 is B, G, R, A in memory.
W, H = 52, 44
blush = bytearray()
for y in range(H):
    for x in range(W):
        d = math.hypot((x + 0.5 - W / 2) / (W / 2), (y + 0.5 - H / 2) / (H / 2))
        a = round(255 * max(0.0, 1.0 - d) ** 1.2)
        blush += bytes((116, 118, 238, a))
(ART / "blush.argb").write_bytes(bytes(blush))
