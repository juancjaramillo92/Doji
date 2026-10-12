#!/bin/sh
# Doji's typeface, Hanken Grotesk, as the four LVGL fonts the charm draws in:
# 64 px at weight 800 for the journal's words, 16 px at 700 for the labels,
# 36 px at 600 for the numbers, the volume's and the charge's, and 18 px at 600
# for the setup screen. Only the letters they use, the space by its code point,
# uncompressed, since this LVGL build decodes no RLE. And the setup page's own
# copy, weights 400 to 700, Latin only, as WOFF2: the phone has no internet to
# fetch it from while it is on her network, so she serves it.
# Needs fonttools (pip) and lv_font_conv (npm); neither ships. Run from charm/,
# and the same font gives the same files.
set -e
main=$PWD/main
tmp=$(mktemp -d)
cp art/HankenGrotesk.ttf "$tmp/variable.ttf"
cd "$tmp"
fonttools varLib.instancer -q variable.ttf wght=800 -o 800.ttf
fonttools varLib.instancer -q variable.ttf wght=700 -o 700.ttf
fonttools varLib.instancer -q variable.ttf wght=600 -o 600.ttf
fonttools varLib.instancer -q variable.ttf wght=400:700 -o page.ttf
lv_font_conv --font 800.ttf --size 64 --bpp 4 --no-compress --symbols 'BELPRSTU&' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_64 -o hanken_64.c
lv_font_conv --font 700.ttf --size 16 --bpp 4 --no-compress --symbols 'SETUPVOLM' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_16 -o hanken_16.c
lv_font_conv --font 600.ttf --size 36 --bpp 4 --no-compress --symbols '0123456789%' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_36 -o hanken_36.c
lv_font_conv --font 600.ttf --size 18 --bpp 4 --no-compress --range 0x20 \
  --symbols '0123456789ABCDEFPTWacdeghikmnorsty-' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_18 -o hanken_18.c
fonttools subset page.ttf --unicodes=U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2022,U+2026,U+2192 \
  --layout-features=kern,liga --flavor=woff2 --output-file=setup.woff2
mv hanken_64.c hanken_16.c hanken_36.c hanken_18.c setup.woff2 "$main/"
cd - >/dev/null
rm -r "$tmp"
