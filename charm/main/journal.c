/* The journal on her screen, the playgrounds' (claude.ai artifacts "Gladys,
   on the charm" and "Your charm"): each question owns the whole screen, split
   down the middle, with one word in Doji's typeface and nothing else to read.
   Right is yes and left is no. Tapping a half rather than swiping: a swipe
   moves the whole screen, which this chip may not draw smoothly, so taps first
   until the real board says otherwise. It sits on LVGL's top layer, over her
   face. */
#include "journal.h"

#include "bsp/esp-bsp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "lvgl.h"
#include "palette.h"

LV_FONT_DECLARE(hanken_64);
LV_FONT_DECLARE(hanken_16);

// The words, in the letters tools/fonts.sh gives the font; agree.test.mjs
// holds the two together.
static const char *const WORDS[4] = { "SETUP", "RULES", "SL", "TP" };
static const char *const SHORT[2] = { "B&R", "S&R" };

/* The halves, in Doji's purples rather than a win's green and a loss's red:
   no is the cool blue-violet on the left, yes the warm magenta on the right,
   each a gradient, top to bottom, that brightens when tapped. The setup's two
   halves share one. As the playground ("Your charm") has them. */
static const uint32_t HALVES[3][2][2] = {
    //            resting               lit
    /* setup */ { { 0x16123a, 0x221a4e }, { DEEP,     GLOW     } },
    /* no    */ { { 0x120f33, 0x1d1a4a }, { 0x3a3aa8, VIOLET   } },
    /* yes   */ { { 0x22103a, 0x34184f }, { ACCENT,   0xd26ce6 } },
};

#define ASK_MS   60000  // then she goes back to sleep, the rest left waiting
#define FLASH_MS 260

static lv_obj_t *root, *half[2], *half_word[2], *tag, *pill, *word, *dots[4];
static QueueHandle_t taps;
static int asked = -1;

static void on_tap(lv_event_t *e) {
    (void)e;
    lv_point_t p;
    lv_indev_get_point(lv_indev_active(), &p);
    int side = p.x >= 233;
    xQueueOverwrite(taps, &side);
}

// A half in its gradient: kind 0 the setup, 1 no, 2 yes.
static void paint(lv_obj_t *o, int kind, bool lit) {
    lv_obj_set_style_bg_color(o, lv_color_hex(HALVES[kind][lit][0]), 0);
    lv_obj_set_style_bg_grad_color(o, lv_color_hex(HALVES[kind][lit][1]), 0);
    lv_obj_set_style_bg_grad_dir(o, LV_GRAD_DIR_VER, 0);
}

static lv_obj_t *box(lv_obj_t *parent, int x, int y, int w, int h, uint32_t bg) {
    lv_obj_t *o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_set_pos(o, x, y);
    lv_obj_set_size(o, w, h);
    lv_obj_set_style_bg_color(o, lv_color_hex(bg), 0);
    lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    return o;
}

static lv_obj_t *text(lv_obj_t *parent, const lv_font_t *font, uint32_t color, int spacing) {
    lv_obj_t *l = lv_label_create(parent);
    lv_obj_set_style_text_font(l, font, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
    lv_obj_set_style_text_letter_space(l, spacing, 0);
    lv_obj_center(l);
    return l;
}

// Built on first use, under the display lock.
static void build(void) {
    taps = xQueueCreate(1, sizeof(int));
    root = box(lv_layer_top(), 0, 0, 466, 466, 0x000000);
    lv_obj_add_flag(root, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(root, on_tap, LV_EVENT_CLICKED, NULL);
    for (int i = 0; i < 2; i++) {
        half[i] = box(root, i ? 235 : 0, 0, 231, 466, 0x000000);
        half_word[i] = text(half[i], &hanken_64, INK, 1);
        lv_label_set_text_static(half_word[i], SHORT[i]);
    }
    tag = box(root, 183, 70, 100, 34, 0x000000);
    lv_obj_set_style_radius(tag, 17, 0);
    lv_label_set_text_static(text(tag, &hanken_16, MUTED, 2), WORDS[0]);

    pill = box(root, 0, 190, 150, 88, GROUND);
    lv_obj_set_style_radius(pill, 44, 0);
    lv_obj_set_style_border_color(pill, lv_color_hex(LINE), 0);
    lv_obj_set_style_border_width(pill, 2, 0);
    word = text(pill, &hanken_64, INK, 2);

    for (int i = 0; i < 4; i++) {
        dots[i] = box(root, 0, 0, 10, 10, INK);
        lv_obj_set_style_radius(dots[i], LV_RADIUS_CIRCLE, 0);
    }
}

int journal_ask(int q, const bool missing[4]) {
    bsp_display_lock(-1);
    if (!root) build();
    bool setup = q == 0;
    for (int i = 0; i < 2; i++) {
        paint(half[i], setup ? 0 : 1 + i, false);
        lv_obj_set_style_text_color(half_word[i], lv_color_hex(INK), 0);
        if (setup) lv_obj_remove_flag(half_word[i], LV_OBJ_FLAG_HIDDEN);
        else lv_obj_add_flag(half_word[i], LV_OBJ_FLAG_HIDDEN);
    }
    if (setup) {
        lv_obj_remove_flag(tag, LV_OBJ_FLAG_HIDDEN);
        lv_obj_add_flag(pill, LV_OBJ_FLAG_HIDDEN);
    } else {
        lv_obj_add_flag(tag, LV_OBJ_FLAG_HIDDEN);
        lv_obj_remove_flag(pill, LV_OBJ_FLAG_HIDDEN);
        lv_label_set_text_static(word, WORDS[q]);
        // The word with room either side, never narrower than the pill's own curve.
        lv_obj_update_layout(word);
        int32_t w = lv_obj_get_width(word) + 64;
        lv_obj_set_width(pill, w > 150 ? w : 150);
        lv_obj_align(pill, LV_ALIGN_TOP_MID, 0, 190);
        if (q != asked) lv_obj_fade_in(pill, 180, 0);
    }
    for (int i = 0; i < 4; i++) {
        int r = i == q ? 5 : 4;
        lv_obj_set_size(dots[i], 2 * r, 2 * r);
        lv_obj_set_pos(dots[i], 233 + (i - 1.5f) * 22 - r, 34 - r);
        lv_obj_set_style_bg_color(dots[i], lv_color_hex(!missing[i] ? ACCENT : INK), 0);
        lv_obj_set_style_bg_opa(dots[i], !missing[i] || i == q ? LV_OPA_COVER : 56, 0);
    }
    asked = q;
    lv_obj_remove_flag(root, LV_OBJ_FLAG_HIDDEN);
    bsp_display_unlock();

    xQueueReset(taps);
    int side;
    if (!xQueueReceive(taps, &side, pdMS_TO_TICKS(ASK_MS))) return -1;

    bsp_display_lock(-1);
    paint(half[side], setup ? 0 : 1 + side, true);
    if (setup) lv_obj_set_style_text_color(half_word[side], lv_color_white(), 0);
    bsp_display_unlock();
    vTaskDelay(pdMS_TO_TICKS(FLASH_MS));
    return side;
}

void journal_hide(void) {
    bsp_display_lock(-1);
    if (root) lv_obj_add_flag(root, LV_OBJ_FLAG_HIDDEN);
    asked = -1;
    bsp_display_unlock();
}
