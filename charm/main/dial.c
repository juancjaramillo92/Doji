/* The volume dial, the playground's (claude.ai artifact "Eugenia, on the
   charm"): the screen dims, and round the rim a faint track, the level in
   Doji's emeralds, a white knob at its end, and the number under VOLUME. Gone
   a moment after the finger lifts. It sits on LVGL's top layer, over her
   face, and draws only while it shows. */
#include "dial.h"

#include <math.h>
#include <stdio.h>
#include "config.h"
#include "face.h"
#include "palette.h"
#include "sound.h"

LV_FONT_DECLARE(hanken_16);
LV_FONT_DECLARE(hanken_36);

#define RIM      160    // a press this far from the centre or more is the dial's
#define RADIUS   217    // the track's outer edge
#define WIDTH    6
#define STAY_MS  1200   // shown after the finger lifts
#define STEPS    72     // short arcs to a full turn, for the gradient

static lv_obj_t *veil;
static lv_timer_t *timer;
static bool held, turned;
static float angle, volume, shown;
static uint32_t lifted_at;

static float angle_of(lv_point_t p) { return atan2f(p.y - 233, p.x - 233); }

static void draw(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    lv_opa_t k = (lv_opa_t)(255 * shown);

    lv_draw_rect_dsc_t dim;
    lv_draw_rect_dsc_init(&dim);
    dim.bg_color = lv_color_black();
    dim.bg_opa = (lv_opa_t)(0.45f * k);
    lv_area_t all = { 0, 0, 465, 465 };
    lv_draw_rect(layer, &dim, &all);

    lv_draw_arc_dsc_t a;
    lv_draw_arc_dsc_init(&a);
    a.center.x = 233; a.center.y = 233;
    a.radius = RADIUS; a.width = WIDTH; a.rounded = 1;
    a.start_angle = 0; a.end_angle = 360;
    a.color = lv_color_white();
    a.opa = (lv_opa_t)(0.12f * k);
    lv_draw_arc(layer, &a);

    // The level, from the top, lightening to the light emerald at its end.
    int steps = (int)ceilf(STEPS * volume / 100);
    a.opa = k;
    for (int i = 0; i < steps; i++) {
        a.start_angle = (270 + i * 360 / STEPS) % 360;
        a.end_angle = (271 + (i + 1) * 360 / STEPS) % 360;
        a.color = lv_color_mix(lv_color_hex(GLOW), lv_color_hex(DEEP),
                               (uint8_t)(255 * (i + 1) / steps));
        lv_draw_arc(layer, &a);
    }

    float end = (-90 + 360 * volume / 100) * (float)M_PI / 180;
    float r = RADIUS - WIDTH / 2.0f;
    lv_draw_rect_dsc_t knob;
    lv_draw_rect_dsc_init(&knob);
    knob.bg_color = lv_color_white();
    knob.bg_opa = k;
    knob.radius = LV_RADIUS_CIRCLE;
    knob.shadow_color = lv_color_white();
    knob.shadow_opa = (lv_opa_t)(0.6f * k);
    knob.shadow_width = 8;
    int32_t kx = lroundf(233 + cosf(end) * r), ky = lroundf(233 + sinf(end) * r);
    lv_area_t at = { kx - 8, ky - 8, kx + 8, ky + 8 };
    lv_draw_rect(layer, &knob, &at);

    char number[4];
    snprintf(number, sizeof number, "%d", (int)lroundf(volume));
    lv_draw_label_dsc_t t;
    lv_draw_label_dsc_init(&t);
    t.align = LV_TEXT_ALIGN_CENTER;
    t.opa = k;
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
    lv_area_t big = { 0, 382, 465, 424 };
    lv_draw_label(layer, &t, &big);
}

// Eases in while held and for a moment after, then out, then stops.
static void tick(lv_timer_t *tm) {
    bool on = held || lv_tick_elaps(lifted_at) < STAY_MS;
    shown += ((on ? 1.0f : 0.0f) - shown) * (on ? 0.4f : 0.18f);
    lv_obj_invalidate(veil);
    if (!on && shown < 0.02f) {
        shown = 0;
        lv_obj_add_flag(veil, LV_OBJ_FLAG_HIDDEN);
        lv_timer_pause(tm);
    }
}

void dial_press(lv_point_t p) {
    turned = false;
    held = hypotf(p.x - 233, p.y - 233) >= RIM;
    if (!held) return;
    angle = angle_of(p);
    volume = cfg.volume;
    if (!veil) {
        veil = lv_obj_create(lv_layer_top());
        lv_obj_remove_style_all(veil);
        lv_obj_set_size(veil, 466, 466);
        lv_obj_remove_flag(veil, LV_OBJ_FLAG_CLICKABLE);
        lv_obj_add_event_cb(veil, draw, LV_EVENT_DRAW_MAIN, NULL);
        timer = lv_timer_create(tick, FACE_FRAME_MS, NULL);
    }
    lv_obj_remove_flag(veil, LV_OBJ_FLAG_HIDDEN);
    lv_timer_resume(timer);
}

void dial_slide(lv_point_t p) {
    if (!held) return;
    float a = angle_of(p), d = a - angle;
    if (d > (float)M_PI) d -= 2 * (float)M_PI;
    if (d < -(float)M_PI) d += 2 * (float)M_PI;
    angle = a;
    if (fabsf(d) > 0.002f) turned = true;
    volume = fminf(100, fmaxf(0, volume + d / (2 * (float)M_PI) * 100));
    sound_volume((int)lroundf(volume));
}

void dial_lift(void) {
    if (!held) return;
    held = false;
    lifted_at = lv_tick_get();
    if (turned) {
        cfg.volume = (int)lroundf(volume);
        config_save();
    }
}

