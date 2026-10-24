#!/usr/bin/env python3
"""Turns the charm's art into the bytes the firmware draws.

The screen is drawn in RGB565, so Eugenia's 466 x 466 render becomes
434,312 bytes in LVGL's native little-endian order, embedded as it is: no
decoder runs at boot and nothing is decompressed into memory.

    python3 charm/tools/art.py      # after changing a render in charm/art/
"""
import pathlib
from PIL import Image

ART = pathlib.Path(__file__).resolve().parent.parent / "art"
SIZE = 466

im = Image.open(ART / "eugenia.png").convert("RGB")
assert im.size == (SIZE, SIZE), f"eugenia.png is {im.size}, not {SIZE} x {SIZE}"
px, out = im.tobytes(), bytearray()
for i in range(0, len(px), 3):
    r, g, b = px[i], px[i + 1], px[i + 2]
    out += (((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)).to_bytes(2, "little")
(ART / "eugenia.rgb565").write_bytes(bytes(out))

