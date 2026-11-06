/* The volume dial: the screen dims, and round the rim a faint track, the
   level in Doji's emerald, a white knob at its end, and the number under
   VOLUME. Gone a moment after the finger lifts. It sits on LVGL's top layer,
   over her face, and appears and goes at once: the whole screen is redrawn
   only then. A turn redraws the stretch of rim between the level it was and
   the level it is, and the number, so the finger is followed at the panel's
   own pace. */
#include "dial.h"

#include <math.h>
#include <stdio.h>
#include "config.h"
#include "palette.h"
#include "sound.h"

LV_FONT_DECLARE(hanken_16);
LV_FONT_DECLARE(hanken_36);

#define RIM      160    // a press this far from the centre or more may be the dial's
#define ENGAGE   0.44f  // and becomes it once slid this far round the rim, in radians: 25 degrees
#define RADIUS   217    // the track's outer edge
#define WIDTH    6
#define KNOB     8      // the knob's radius, and its shadow's
#define STAY_MS  1200   // shown after the finger lifts

static const lv_area_t NUMBER = { 0, 382, 465, 424 };

static lv_obj_t *veil;
static lv_timer_t *timer;
static bool armed, held, turned;
static float angle, travel, volume;
static int set;  // the volume the speaker was last given

static float angle_of(lv_point_t p) { return atan2f(p.y - 233, p.x - 233); }

static void draw(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);

    lv_draw_rect_dsc_t dim;
    lv_draw_rect_dsc_init(&dim);
    dim.bg_color = lv_color_black();
    dim.bg_opa = 115;
    lv_area_t all = { 0, 0, 465, 465 };
    lv_draw_rect(layer, &dim, &all);

    lv_draw_arc_dsc_t a;
    lv_draw_arc_dsc_init(&a);
    a.center.x = 233; a.center.y = 233;
    a.radius = RADIUS; a.width = WIDTH; a.rounded = 1;
    a.start_angle = 0; a.end_angle = 360;
    a.color = lv_color_white();
    a.opa = 31;
    lv_draw_arc(layer, &a);

    // The level, from the top.
    if (volume >= 0.5f) {
        a.color = lv_color_hex(GLOW);
        a.opa = LV_OPA_COVER;
        a.start_angle = 270;
        a.end_angle = lroundf(270 + 3.6f * volume);  // a full turn at 100, which LVGL draws as a ring
        lv_draw_arc(layer, &a);
    }

    float end = (-90 + 3.6f * volume) * (float)M_PI / 180;
    float r = RADIUS - WIDTH / 2.0f;
    lv_draw_rect_dsc_t knob;
    lv_draw_rect_dsc_init(&knob);
    knob.bg_color = lv_color_white();
    knob.radius = LV_RADIUS_CIRCLE;
    knob.shadow_color = lv_color_white();
    knob.shadow_opa = 153;
    knob.shadow_width = KNOB;
    int32_t kx = lroundf(233 + cosf(end) * r), ky = lroundf(233 + sinf(end) * r);
    lv_area_t at = { kx - KNOB, ky - KNOB, kx + KNOB, ky + KNOB };
    lv_draw_rect(layer, &knob, &at);

    char number[4];
    snprintf(number, sizeof number, "%d", (int)lroundf(volume));
    lv_draw_label_dsc_t t;
    lv_draw_label_dsc_init(&t);
    t.align = LV_TEXT_ALIGN_CENTER;
    t.font = &hanken_16;
    t.color = lv_color_hex(MUTED);
    t.letter_space = 2;
    t.text = "VOLUME";
    lv_area_t label = { 0, 362, 465, 382 };
    lv_draw_label(layer, &t, &label);
    t.font = &hanken_36;
    t.color = lv_color_white();
    t.letter_space = 0;
    t.text = number;
    t.text_local = 1;
    lv_draw_label(layer, &t, &NUMBER);
}

/* The rim between two levels, knob and shadow and the rounded end included,
   walked in steps short enough that the arc between two of them stays
   inside the margin. */
static void invalidate_between(float from, float to) {
    float lo = fminf(from, to), hi = fmaxf(from, to);
    int32_t pad = WIDTH + 2 * KNOB;
    lv_area_t box = { 465, 465, 0, 0 };
    for (float v = lo;; v += 2) {
        float at = fminf(v, hi), rad = (-90 + 3.6f * at) * (float)M_PI / 180;
        int32_t x = lroundf(233 + cosf(rad) * RADIUS), y = lroundf(233 + sinf(rad) * RADIUS);
        if (x - pad < box.x1) box.x1 = x - pad;
        if (y - pad < box.y1) box.y1 = y - pad;
        if (x + pad > box.x2) box.x2 = x + pad;
        if (y + pad > box.y2) box.y2 = y + pad;
        if (at >= hi) break;
    }
    lv_obj_invalidate_area(veil, &box);
    lv_obj_invalidate_area(veil, &NUMBER);
}

// A moment after the finger lifts, the dial goes, all at once.
static void gone(lv_timer_t *tm) {
    if (!held) lv_obj_add_flag(veil, LV_OBJ_FLAG_HIDDEN);
    lv_timer_pause(tm);
}

/* A press on the rim only arms the dial; it takes hold once the finger has
   slid ENGAGE round the rim without leaving it, so a touch at the edge, or a
   slide across it, never brings it up. The volume moves only after that. */
void dial_press(lv_point_t p) {
    turned = held = false;
    armed = hypotf(p.x - 233, p.y - 233) >= RIM;
    angle = angle_of(p);
    travel = 0;
}

// The speaker is told only when the whole number changes: each is a write
// on the bus the touch is read over.
void dial_slide(lv_point_t p) {
    if (!armed) return;
    float a = angle_of(p), d = a - angle;
    if (d > (float)M_PI) d -= 2 * (float)M_PI;
    if (d < -(float)M_PI) d += 2 * (float)M_PI;
    angle = a;
    if (!held) {
        if (hypotf(p.x - 233, p.y - 233) < RIM) armed = false;
        if (!armed || fabsf(travel += d) < ENGAGE) return;
        held = true;
        volume = set = cfg.volume;
        if (!veil) {
            veil = lv_obj_create(lv_layer_top());
            lv_obj_remove_style_all(veil);
            lv_obj_set_size(veil, 466, 466);
            lv_obj_remove_flag(veil, LV_OBJ_FLAG_CLICKABLE);
            lv_obj_add_flag(veil, LV_OBJ_FLAG_HIDDEN);
            lv_obj_add_event_cb(veil, draw, LV_EVENT_DRAW_MAIN, NULL);
            timer = lv_timer_create(gone, STAY_MS, NULL);
        }
        lv_timer_pause(timer);
        if (lv_obj_has_flag(veil, LV_OBJ_FLAG_HIDDEN)) lv_obj_remove_flag(veil, LV_OBJ_FLAG_HIDDEN);
        else invalidate_between(volume, volume);
        return;
    }
    if (fabsf(d) > 0.002f) turned = true;
    float was = volume;
    volume = fminf(100, fmaxf(0, volume + d / (2 * (float)M_PI) * 100));
    if (volume != was) invalidate_between(was, volume);
    if ((int)lroundf(volume) != set) {
        set = (int)lroundf(volume);
        sound_volume(set);
    }
}

void dial_lift(void) {
    armed = false;
    if (!held) return;
    held = false;
    lv_timer_reset(timer);
    lv_timer_resume(timer);
    if (turned) {
        cfg.volume = set;
        config_save();
    }
}
