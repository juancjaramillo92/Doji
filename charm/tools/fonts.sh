#!/bin/sh
# Doji's typeface, Hanken Grotesk, as the two LVGL fonts the journal screens
# draw: 64 px at weight 800 for the words, 16 px at 700 for the label. Only
# the letters they use, uncompressed, since this LVGL build decodes no RLE.
# Needs fonttools (pip) and lv_font_conv (npm); neither ships. Run from charm/,
# and the same font gives the same files.
set -e
main=$PWD/main
tmp=$(mktemp -d)
cp art/HankenGrotesk.ttf "$tmp/variable.ttf"
cd "$tmp"
fonttools varLib.instancer -q variable.ttf wght=800 -o 800.ttf
fonttools varLib.instancer -q variable.ttf wght=700 -o 700.ttf
lv_font_conv --font 800.ttf --size 64 --bpp 4 --no-compress --symbols 'BELPRSTU&' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_64 -o hanken_64.c
lv_font_conv --font 700.ttf --size 16 --bpp 4 --no-compress --symbols 'SETUP' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_16 -o hanken_16.c
mv hanken_64.c hanken_16.c "$main/"
cd - >/dev/null
rm -r "$tmp"
