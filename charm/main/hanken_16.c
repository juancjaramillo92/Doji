/*******************************************************************************
 * Size: 16 px
 * Bpp: 4
 * Opts: --font 700.ttf --size 16 --bpp 4 --no-compress --symbols SETUP --format lvgl --lv-include lvgl.h --lv-font-name hanken_16 -o hanken_16.c
 ******************************************************************************/

#ifdef LV_LVGL_H_INCLUDE_SIMPLE
#include "lvgl.h"
#else
#include "lvgl.h"
#endif

#ifndef HANKEN_16
#define HANKEN_16 1
#endif

#if HANKEN_16

/*-----------------
 *    BITMAPS
 *----------------*/

/*Store the image of the glyphs*/
static LV_ATTRIBUTE_LARGE_CONST const uint8_t glyph_bitmap[] = {
    /* U+0045 "E" */
    0xef, 0xff, 0xff, 0xf8, 0xef, 0xed, 0xdd, 0xd6,
    0xef, 0x20, 0x0, 0x0, 0xef, 0x20, 0x0, 0x0,
    0xef, 0xdd, 0xdd, 0xd1, 0xef, 0xff, 0xff, 0xf2,
    0xef, 0x20, 0x0, 0x0, 0xef, 0x20, 0x0, 0x0,
    0xef, 0x20, 0x0, 0x0, 0xef, 0xdd, 0xdd, 0xd6,
    0xef, 0xff, 0xff, 0xf8,

    /* U+0050 "P" */
    0xef, 0xff, 0xfb, 0x30, 0xef, 0xed, 0xff, 0xf2,
    0xef, 0x20, 0xc, 0xf7, 0xef, 0x20, 0x8, 0xf8,
    0xef, 0x20, 0x2d, 0xf6, 0xef, 0xff, 0xff, 0xe0,
    0xef, 0xdd, 0xc8, 0x10, 0xef, 0x20, 0x0, 0x0,
    0xef, 0x20, 0x0, 0x0, 0xef, 0x20, 0x0, 0x0,
    0xef, 0x20, 0x0, 0x0,

    /* U+0053 "S" */
    0x0, 0x6d, 0xfe, 0x90, 0x0, 0x6f, 0xfd, 0xff,
    0xb0, 0xc, 0xf7, 0x1, 0xb6, 0x0, 0xbf, 0x80,
    0x0, 0x0, 0x4, 0xff, 0xc6, 0x0, 0x0, 0x3,
    0xcf, 0xfe, 0x60, 0x0, 0x0, 0x29, 0xff, 0x42,
    0x86, 0x0, 0x8, 0xf9, 0x5f, 0xe3, 0x0, 0xaf,
    0x80, 0xbf, 0xfd, 0xef, 0xf2, 0x0, 0x8d, 0xff,
    0xb2, 0x0,

    /* U+0054 "T" */
    0xdf, 0xff, 0xff, 0xff, 0xf2, 0xbd, 0xde, 0xff,
    0xdd, 0xd2, 0x0, 0x6, 0xfb, 0x0, 0x0, 0x0,
    0x6, 0xfb, 0x0, 0x0, 0x0, 0x6, 0xfb, 0x0,
    0x0, 0x0, 0x6, 0xfb, 0x0, 0x0, 0x0, 0x6,
    0xfb, 0x0, 0x0, 0x0, 0x6, 0xfb, 0x0, 0x0,
    0x0, 0x6, 0xfb, 0x0, 0x0, 0x0, 0x6, 0xfb,
    0x0, 0x0, 0x0, 0x6, 0xfb, 0x0, 0x0,

    /* U+0055 "U" */
    0xf, 0xf0, 0x0, 0x8, 0xf8, 0xf, 0xf0, 0x0,
    0x8, 0xf8, 0xf, 0xf0, 0x0, 0x8, 0xf8, 0xf,
    0xf0, 0x0, 0x8, 0xf8, 0xf, 0xf0, 0x0, 0x8,
    0xf8, 0xf, 0xf0, 0x0, 0x8, 0xf8, 0xf, 0xf0,
    0x0, 0x8, 0xf8, 0xf, 0xf2, 0x0, 0x9, 0xf7,
    0xc, 0xf9, 0x0, 0x2e, 0xf4, 0x5, 0xff, 0xfe,
    0xff, 0xc0, 0x0, 0x4c, 0xff, 0xe8, 0x0
};


/*---------------------
 *  GLYPH DESCRIPTION
 *--------------------*/

static const lv_font_fmt_txt_glyph_dsc_t glyph_dsc[] = {
    {.bitmap_index = 0, .adv_w = 0, .box_w = 0, .box_h = 0, .ofs_x = 0, .ofs_y = 0} /* id = 0 reserved */,
    {.bitmap_index = 0, .adv_w = 148, .box_w = 8, .box_h = 11, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 44, .adv_w = 144, .box_w = 8, .box_h = 11, .ofs_x = 1, .ofs_y = 0},
    {.bitmap_index = 88, .adv_w = 147, .box_w = 9, .box_h = 11, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 138, .adv_w = 150, .box_w = 10, .box_h = 11, .ofs_x = 0, .ofs_y = 0},
    {.bitmap_index = 193, .adv_w = 168, .box_w = 10, .box_h = 11, .ofs_x = 0, .ofs_y = 0}
};

/*---------------------
 *  CHARACTER MAPPING
 *--------------------*/

static const uint16_t unicode_list_0[] = {
    0x0, 0xb, 0xe, 0xf, 0x10
};

/*Collect the unicode lists and glyph_id offsets*/
static const lv_font_fmt_txt_cmap_t cmaps[] =
{
    {
        .range_start = 69, .range_length = 17, .glyph_id_start = 1,
        .unicode_list = unicode_list_0, .glyph_id_ofs_list = NULL, .list_length = 5, .type = LV_FONT_FMT_TXT_CMAP_SPARSE_TINY
    }
};

/*-----------------
 *    KERNING
 *----------------*/


/*Pair left and right glyphs for kerning*/
static const uint8_t kern_pair_glyph_ids[] =
{
    1, 3,
    2, 3,
    3, 4,
    4, 3
};

/* Kerning between the respective left and right glyphs
 * 4.4 format which needs to scaled with `kern_scale`*/
static const int8_t kern_pair_values[] =
{
    -1, -2, -1, -3
};

/*Collect the kern pair's data in one place*/
static const lv_font_fmt_txt_kern_pair_t kern_pairs =
{
    .glyph_ids = kern_pair_glyph_ids,
    .values = kern_pair_values,
    .pair_cnt = 4,
    .glyph_ids_size = 0
};

/*--------------------
 *  ALL CUSTOM DATA
 *--------------------*/

#if LVGL_VERSION_MAJOR == 8
/*Store all the custom data of the font*/
static  lv_font_fmt_txt_glyph_cache_t cache;
#endif

#if LVGL_VERSION_MAJOR >= 8
static const lv_font_fmt_txt_dsc_t font_dsc = {
#else
static lv_font_fmt_txt_dsc_t font_dsc = {
#endif
    .glyph_bitmap = glyph_bitmap,
    .glyph_dsc = glyph_dsc,
    .cmaps = cmaps,
    .kern_dsc = &kern_pairs,
    .kern_scale = 16,
    .cmap_num = 1,
    .bpp = 4,
    .kern_classes = 0,
    .bitmap_format = 0,
#if LVGL_VERSION_MAJOR == 8
    .cache = &cache
#endif
};



/*-----------------
 *  PUBLIC FONT
 *----------------*/

/*Initialize a public general font descriptor*/
#if LVGL_VERSION_MAJOR >= 8
const lv_font_t hanken_16 = {
#else
lv_font_t hanken_16 = {
#endif
    .get_glyph_dsc = lv_font_get_glyph_dsc_fmt_txt,    /*Function pointer to get glyph's data*/
    .get_glyph_bitmap = lv_font_get_bitmap_fmt_txt,    /*Function pointer to get glyph's bitmap*/
    .line_height = 11,          /*The maximum line height required by the font*/
    .base_line = 0,             /*Baseline measured from the bottom of the line*/
#if !(LVGL_VERSION_MAJOR == 6 && LVGL_VERSION_MINOR == 0)
    .subpx = LV_FONT_SUBPX_NONE,
#endif
#if LV_VERSION_CHECK(7, 4, 0) || LVGL_VERSION_MAJOR >= 8
    .underline_position = -2,
    .underline_thickness = 1,
#endif
    .dsc = &font_dsc,          /*The custom font data. Will be accessed by `get_glyph_bitmap/dsc` */
#if LV_VERSION_CHECK(8, 2, 0) || LVGL_VERSION_MAJOR >= 9
    .fallback = NULL,
#endif
    .user_data = NULL,
};



#endif /*#if HANKEN_16*/

