#!/bin/sh
# Doji's typeface, Hanken Grotesk, as the three LVGL fonts the charm draws in:
# 64 px at weight 800 for the journal's words, 16 px at 700 for the labels,
# and 36 px at 600 for the numbers, the volume's and the charge's. Only the
# letters they use, uncompressed, since this LVGL build decodes no RLE.
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
lv_font_conv --font 800.ttf --size 64 --bpp 4 --no-compress --symbols 'BELPRSTU&' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_64 -o hanken_64.c
lv_font_conv --font 700.ttf --size 16 --bpp 4 --no-compress --symbols 'SETUPVOLM' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_16 -o hanken_16.c
lv_font_conv --font 600.ttf --size 36 --bpp 4 --no-compress --symbols '0123456789%' \
  --format lvgl --lv-include lvgl.h --lv-font-name hanken_36 -o hanken_36.c
mv hanken_64.c hanken_16.c hanken_36.c "$main/"
cd - >/dev/null
rm -r "$tmp"
