/* The face: Eugenia as one still render, her eyes, mouth and cheeks drawn
   live on top of it. Only the face's own patch of screen is redrawn on a
   frame, which is what keeps it smooth on this chip — the ring is the only
   thing that redraws the full screen, and only while it shows.

   The sleep screen is a layer over her: black but for its marks.

   The numbers are the playgrounds' (claude.ai artifacts "Eugenia, on the
   charm" and "Your charm"), measured from each render, in pixels of the
   466 x 466 screen. */
#include "face.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include "esp_random.h"
#include "lvgl.h"
#include "palette.h"

LV_FONT_DECLARE(hanken_36);

typedef struct {
    float eye_l[2], eye_r[2], rx, ry;
    float hl[3];                      // highlight dx, dy, radius
    float mouth[2], mouth_w, sag, stroke;
    float blush_l[2], blush_r[2];
} face_geometry_t;

static const face_geometry_t F = {
    {168.9f, 230.0f}, {292.7f, 230.0f}, 12.59f, 13.5f,
    {7.8f, -7.3f, 2.7f},
    {231.9f, 254.6f}, 38.0f, 6.9f, 3.2f,
    {164.3f, 262.6f}, {301.7f, 262.6f},
};

// Tunings from the playground's defaults.
#define BLINK_EVERY_MS  4000
#define LOOK_RANGE      6.0f
#define BLUSH           0.55f
#define SHIFT_X         8     // how far the sleep screen's marks wander, so none burns in
#define SHIFT_Y         4

extern const uint8_t eugenia_rgb565_start[] asm("_binary_eugenia_rgb565_start");
extern const uint8_t blush_argb_start[]     asm("_binary_blush_argb_start");

static lv_image_dsc_t art_dsc = {
    .header = { .magic = LV_IMAGE_HEADER_MAGIC, .cf = LV_COLOR_FORMAT_RGB565, .w = 466, .h = 466, .stride = 466 * 2 },
    .data_size = 466 * 466 * 2,
};

static lv_image_dsc_t blush_dsc = {
    .header = { .magic = LV_IMAGE_HEADER_MAGIC, .cf = LV_COLOR_FORMAT_ARGB8888,
                .w = 52, .h = 44, .stride = 52 * 4 },
    .data_size = 52 * 44 * 4,
};

static lv_obj_t *card, *night;

static volatile face_mode_t mode = FACE_IDLE;
static volatile float level, hold;
static volatile bool briefing_waits, trade_waits, low, offline;
static volatile int charge = -1;

// What is on screen, eased toward what the mode asks for.
static struct { float open, gx, gy, mouth, smile, blush, ring, dots, confused; } V = { .open = 0, .smile = 1 };
static float gaze[2];
static uint32_t next_glance, next_blink, blink_at;
static float lid = 1;  // the blink, on top of how open the mode wants the eyes
static bool blinking, ring_was_on;
static bool dark;
static int shift[2];

void face_set_mode(face_mode_t m) { mode = m; }
face_mode_t face_get_mode(void) { return mode; }
void face_set_level(float l) { level = l < 0 ? 0 : l > 1 ? 1 : l; }
void face_set_hold(float h) { hold = h < 0 ? 0 : h > 1 ? 1 : h; }
void face_set_marks(bool b, bool t, bool l, bool o, int c) {
    briefing_waits = b; trade_waits = t; low = l; offline = o; charge = c;
}

int face_marks(bool b, bool t, bool l, bool o, int c) {
    return b | t << 1 | l << 2 | o << 3 | (c + 1) << 4;
}

static float rnd(void) { return (float)esp_random() / 4294967295.0f; }

// The sleep screen's marks, a new place each time it shows.
static void wander(void) {
    shift[0] = (int)lroundf((rnd() * 2 - 1) * SHIFT_X);
    shift[1] = (int)lroundf((rnd() * 2 - 1) * SHIFT_Y);
}

static float ease(float v, float t, float rate, float dt) {
    return v + (t - v) * (1.0f - expf(-rate * dt));
}

/* A smile through its two ends and its lowest point, as an arc of the circle
   those three points lie on — LVGL draws arcs anti-aliased, and at this size
   the arc and the playground's quadratic curve are the same line. A frown is
   the same circle below; a straight mouth is a line. */
static void draw_curve(lv_layer_t *layer, float cx, float y, float half, float sag,
                       float width, lv_color_t color) {
    if (fabsf(sag) < 0.6f) {
        lv_draw_line_dsc_t d;
        lv_draw_line_dsc_init(&d);
        d.p1.x = cx - half; d.p1.y = y; d.p2.x = cx + half; d.p2.y = y;
        d.width = width; d.round_start = 1; d.round_end = 1; d.color = color;
        lv_draw_line(layer, &d);
        return;
    }
    float s = fabsf(sag), r = (half * half + s * s) / (2 * s);
    float cy = sag > 0 ? y + sag - r : y + sag + r;
    float a_r = atan2f(y - cy, half) * 180.0f / (float)M_PI;
    float a_l = atan2f(y - cy, -half) * 180.0f / (float)M_PI;
    if (a_r < 0) a_r += 360;
    if (a_l < 0) a_l += 360;
    lv_draw_arc_dsc_t d;
    lv_draw_arc_dsc_init(&d);
    d.center.x = (int32_t)lroundf(cx); d.center.y = (int32_t)lroundf(cy);
    d.radius = (uint16_t)lroundf(r);
    d.start_angle = sag > 0 ? a_r : a_l;
    d.end_angle = sag > 0 ? a_l : a_r;
    d.width = width; d.rounded = 1; d.color = color;
    lv_draw_arc(layer, &d);
}

static void dot(lv_layer_t *layer, float cx, float cy, float rx, float ry,
                lv_color_t color, lv_opa_t opa) {
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_color = color; d.bg_opa = opa; d.radius = LV_RADIUS_CIRCLE;
    lv_area_t a = { lroundf(cx - rx), lroundf(cy - ry), lroundf(cx + rx), lroundf(cy + ry) };
    lv_draw_rect(layer, &d, &a);
}

// Short arcs, each the colour of its place: LVGL draws no conic gradient.
static const uint32_t RING[] = { DEEP, ACCENT, GLOW, TEAL, DEEP };
#define RING_STEPS 36

void face_ring(lv_layer_t *layer, int32_t radius, int32_t width, float part, float turn, float opa) {
    int steps = (int)ceilf(RING_STEPS * part);
    for (int i = 0; i < steps; i++) {
        float at = fmodf((float)i / RING_STEPS + turn, 1.0f) * 4;
        int k = (int)at;
        lv_draw_arc_dsc_t d;
        lv_draw_arc_dsc_init(&d);
        d.center.x = 233; d.center.y = 233;
        d.width = width;
        d.radius = radius;
        d.start_angle = (270 + i * 360 / RING_STEPS) % 360;
        d.end_angle = (271 + (i + 1) * 360 / RING_STEPS) % 360;  // a degree over: no seams
        d.color = lv_color_mix(lv_color_hex(RING[k + 1]), lv_color_hex(RING[k]), (uint8_t)(255 * (at - k)));
        d.opa = (lv_opa_t)(255 * opa);
        lv_draw_arc(layer, &d);
    }
}

// No internet: the arcs of a signal, struck through.
static void draw_offline(lv_layer_t *layer, int x, int y) {
    lv_draw_arc_dsc_t a;
    lv_draw_arc_dsc_init(&a);
    a.center.x = x; a.center.y = y + 6;
    a.width = 2; a.rounded = 1; a.color = lv_color_hex(MUTED);
    a.start_angle = 225; a.end_angle = 315;
    for (int r = 5; r <= 15; r += 5) { a.radius = r; lv_draw_arc(layer, &a); }
    lv_draw_line_dsc_t l;
    lv_draw_line_dsc_init(&l);
    l.p1.x = x - 11; l.p1.y = y - 9; l.p2.x = x + 11; l.p2.y = y + 9;
    l.width = 2; l.round_start = 1; l.round_end = 1; l.color = lv_color_hex(GLOW);
    lv_draw_line(layer, &l);
}

// Low and nothing charging: a small battery with a sliver left.
static void draw_low(lv_layer_t *layer, int bx, int by) {
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_opa = LV_OPA_TRANSP; d.radius = 4;
    d.border_color = lv_color_hex(MUTED); d.border_width = 2; d.border_opa = LV_OPA_COVER;
    lv_area_t body = { bx - 16, by - 8, bx + 14, by + 8 };
    lv_draw_rect(layer, &d, &body);
    lv_draw_rect_dsc_init(&d);
    d.bg_color = lv_color_hex(MUTED); d.radius = 1;
    lv_area_t nub = { bx + 15, by - 3, bx + 18, by + 3 };
    lv_draw_rect(layer, &d, &nub);
    d.bg_color = lv_color_hex(GLOW); d.radius = 2;
    d.shadow_color = lv_color_hex(GLOW); d.shadow_width = 8; d.shadow_opa = 200;
    lv_area_t left = { bx - 13, by - 5, bx - 7, by + 5 };
    lv_draw_rect(layer, &d, &left);
}

// PWR held: a quiet ring round the rim, emptying toward switching off.
static void draw_hold(lv_layer_t *layer) {
    lv_draw_arc_dsc_t a;
    lv_draw_arc_dsc_init(&a);
    a.center.x = 233; a.center.y = 233;
    a.radius = 222; a.width = 6; a.rounded = 1; a.color = lv_color_hex(MUTED);
    a.start_angle = 270;
    a.end_angle = (int32_t)(270 + 360 * (1 - hold)) % 360;
    if (hold < 0.99f) lv_draw_arc(layer, &a);
}

static void draw_face(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    float open = V.open * lid;
    const lv_color_t ink = lv_color_hex(0x0d0c0b);

    for (int i = 0; i < 2; i++) {
        const float *b = i ? F.blush_r : F.blush_l;
        lv_draw_image_dsc_t d;
        lv_draw_image_dsc_init(&d);
        d.src = &blush_dsc;
        d.opa = (lv_opa_t)(255 * 0.62f * V.blush);
        lv_area_t a = { lroundf(b[0] - 26), lroundf(b[1] - 22), lroundf(b[0] + 25), lroundf(b[1] + 21) };
        lv_draw_image(layer, &d, &a);
    }

    // Eyes, a line when shut, with the highlight once open enough to hold it.
    // Confused, one is smaller and they sit at a tilt.
    for (int i = 0; i < 2; i++) {
        const float *eye = i ? F.eye_r : F.eye_l;
        float odd = 1 + V.confused * (i ? 0.12f : -0.18f);
        float cx = eye[0] + V.gx, cy = eye[1] + V.gy + V.confused * (i ? -1.6f : 1.6f);
        float rx = F.rx * odd, ry = F.ry * odd * open;
        if (ry < 1.8f) {
            draw_curve(layer, cx, cy, rx * 0.9f, 1.2f, 2.6f, ink);
            continue;
        }
        dot(layer, cx, cy, rx, ry, ink, LV_OPA_COVER);
        if (open > 0.45f) {
            float k = open - 0.45f > 0.25f ? 1.0f : (open - 0.45f) * 4;
            dot(layer, cx + F.hl[0], cy + F.hl[1] * open, F.hl[2], F.hl[2],
                lv_color_hex(0xf2f0ec), (lv_opa_t)(235 * k));
        }
    }

    // Mouth: the smile, or open while she speaks.
    float mx = F.mouth[0], my = F.mouth[1];
    if (V.mouth < 0.06f) {
        draw_curve(layer, mx, my, F.mouth_w / 2, F.sag * V.smile, F.stroke, ink);
    } else {
        float half = F.mouth_w / 2 * 0.86f, h = V.mouth * 12.0f;
        lv_draw_rect_dsc_t d;
        lv_draw_rect_dsc_init(&d);
        d.bg_color = lv_color_hex(0x1d0e0b); d.radius = LV_RADIUS_CIRCLE;
        d.border_color = ink; d.border_width = 2; d.border_opa = LV_OPA_COVER;
        lv_area_t a = { lroundf(mx - half), lroundf(my - 1), lroundf(mx + half),
                        lroundf(my + F.sag * 0.8f + 2 * h) };
        lv_draw_rect(layer, &d, &a);
    }

    // Thought dots above her head, lighting up one after another.
    if (V.dots > 0.02f) {
        static const float dots[3][3] = { { 208, 52, 3.2f }, { 233, 44, 3.8f }, { 258, 52, 3.2f } };
        uint32_t now = lv_tick_get();
        for (int i = 0; i < 3; i++) {
            float pulse = 0.5f + 0.5f * sinf(now / 260.0f - i * 1.1f);
            dot(layer, dots[i][0], dots[i][1] - pulse * 2.5f, dots[i][2], dots[i][2], lv_color_hex(0xead3b6),
                (lv_opa_t)(255 * V.dots * (0.25f + 0.75f * pulse)));
        }
    }

    // The ring on the rim, while listening, follows his voice.
    if (V.ring > 0.02f) face_ring(layer, 231, 4 + (int32_t)(7 * V.ring), 1, lv_tick_get() / (float)FACE_RING_TURN_MS, 0.35f + 0.65f * V.ring);
    if (hold > 0) draw_hold(layer);
}

/* The sleep screen, still, so it stays on the panel while the chip sleeps.
   Low on the screen, one mark for what waits: Eugenia's emerald dot with a
   glow for a briefing, a white ring for a trade, the dot inside the ring for
   both — one place and one size each, so nothing moves or shrinks when the
   other arrives, and shape tells them apart. At the top, a small battery when
   low and the no-internet mark when offline, side by side when both. On the
   cable, the charge round the rim. All but the ring wander a few pixels each
   time she sleeps. */
static void draw_night(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    int x = 233 + shift[0], y = 404 + shift[1];
    // The ring near white: grey on black reads as a smudge.
    if (trade_waits) {
        lv_draw_arc_dsc_t a;
        lv_draw_arc_dsc_init(&a);
        a.center.x = x; a.center.y = y;
        a.radius = 19; a.width = 3; a.start_angle = 0; a.end_angle = 360;
        a.color = lv_color_hex(0xecf4ef);
        lv_draw_arc(layer, &a);
    }
    if (briefing_waits) {
        lv_draw_rect_dsc_t d;
        lv_draw_rect_dsc_init(&d);
        d.bg_color = lv_color_hex(GLOW);
        d.radius = LV_RADIUS_CIRCLE;
        d.shadow_color = lv_color_hex(ACCENT);
        d.shadow_opa = 230;
        d.shadow_width = 22;
        lv_area_t a = { x - 9, y - 9, x + 9, y + 9 };
        lv_draw_rect(layer, &d, &a);
    }

    bool tired = low && charge < 0, both = tired && offline;
    int top = 62 + shift[1];
    if (tired) draw_low(layer, both ? x - 22 : x, top);
    if (offline) draw_offline(layer, both ? x + 22 : x, top);

    if (charge >= 0) {
        lv_draw_arc_dsc_t a;
        lv_draw_arc_dsc_init(&a);
        a.center.x = 233; a.center.y = 233;
        a.radius = 226; a.width = 4; a.start_angle = 0; a.end_angle = 360;
        a.color = lv_color_white(); a.opa = 20;
        lv_draw_arc(layer, &a);
        face_ring(layer, 226, 4, charge / 100.0f, 0, 1);
        static char percent[5];
        snprintf(percent, sizeof percent, "%d%%", charge);
        lv_draw_label_dsc_t t;
        lv_draw_label_dsc_init(&t);
        t.align = LV_TEXT_ALIGN_CENTER;
        t.font = &hanken_36;
        t.color = lv_color_hex(charge == 100 ? INK : MUTED);
        t.text = percent;
        lv_area_t where = { shift[0], 211 + shift[1], 465 + shift[0], 255 + shift[1] };
        lv_draw_label(layer, &t, &where);
    }
    if (hold > 0) draw_hold(layer);
}

static void tick(lv_timer_t *t) {
    (void)t;
    static uint32_t last;
    uint32_t now = lv_tick_get();
    float dt = last ? (float)(now - last) / 1000.0f : 0.033f;
    if (dt > 0.05f) dt = 0.05f;
    last = now;

    face_mode_t m = mode;

    // Into or out of the sleep screen: the whole screen changes once. On the
    // way in her marks find a new place; on the way out her eyes open from shut.
    if ((m == FACE_DARK) != dark) {
        dark = m == FACE_DARK;
        if (dark) {
            wander();
            lv_obj_add_flag(card, LV_OBJ_FLAG_HIDDEN);
            lv_obj_remove_flag(night, LV_OBJ_FLAG_HIDDEN);
            lv_obj_invalidate(night);
        } else {
            lv_obj_remove_flag(card, LV_OBJ_FLAG_HIDDEN);
            lv_obj_add_flag(night, LV_OBJ_FLAG_HIDDEN);
        }
        V.open = 0;
    }
    // PWR held: the whole screen, for the emptying ring, while it lasts.
    static bool held;
    bool holding = hold > 0;
    if (holding || held) lv_obj_invalidate(lv_screen_active());
    held = holding;
    if (dark) {
        // Redrawn only when a mark changes: the panel holds the rest.
        static int drawn = -1;
        int marks = face_marks(briefing_waits, trade_waits, low, offline, charge);
        if (marks != drawn) lv_obj_invalidate(night);
        drawn = marks;
        return;
    }

    float t_open = 1, t_mouth = 0, t_smile = 1, t_ring = 0, t_dots = 0, t_confused = 0, glance = 1;
    float t_blush = BLUSH;
    const float *fixed = NULL;
    static const float up[2] = { 0, -2 }, puzzled[2] = { 3, -2.5f }, rest[2] = { 0, 1 };
    // Thinking looks up to one side, then the other, every 1.7 seconds.
    float pondering[2] = { (now / 1700) % 2 ? -LOOK_RANGE * 0.55f : LOOK_RANGE * 0.9f, -LOOK_RANGE };
    if (m == FACE_LISTENING) { t_smile = 1.1f; t_ring = 0.25f + 0.75f * level; fixed = up; }
    if (m == FACE_SPEAKING)  { t_mouth = level; t_smile = 0.9f; glance = 0.4f; }
    if (m == FACE_THINKING)  { t_open = 0.85f; t_smile = 0.25f; t_dots = 1; fixed = pondering; }
    if (m == FACE_CONFUSED)  { t_smile = -0.35f; t_confused = 1; fixed = puzzled; }
    if (m == FACE_ASLEEP)    { t_open = 0; t_smile = 0.6f; fixed = rest; }

    // Glances: a quick jump to a point, held for a moment.
    if (fixed) { gaze[0] = fixed[0]; gaze[1] = fixed[1]; }
    else if ((int32_t)(now - next_glance) >= 0) {
        float a = rnd() * 2 * (float)M_PI, r = sqrtf(rnd()) * LOOK_RANGE * glance;
        gaze[0] = cosf(a) * r; gaze[1] = sinf(a) * r * 0.7f;
        next_glance = now + 1200 + (uint32_t)(rnd() * 2800);
    }

    // Blinks: shut in 70 ms, open in 90.
    lid = 1;
    if (!blinking && m != FACE_ASLEEP && (int32_t)(now - next_blink) >= 0) { blinking = true; blink_at = now; }
    if (blinking) {
        uint32_t b = now - blink_at;
        lid = b < 70 ? 1 - b / 70.0f : b < 160 ? (b - 70) / 90.0f : 1;
        if (b >= 160) {
            blinking = false;
            next_blink = now + (uint32_t)(BLINK_EVERY_MS * (0.6f + rnd() * 0.8f));
        }
    }

    V.open = ease(V.open, t_open, m == FACE_ASLEEP ? 3 : 16, dt);
    V.gx = ease(V.gx, gaze[0], 22, dt);
    V.gy = ease(V.gy, gaze[1], 22, dt);
    V.mouth = ease(V.mouth, t_mouth, 28, dt);
    V.smile = ease(V.smile, t_smile, 10, dt);
    V.blush = ease(V.blush, t_blush, 4, dt);
    V.ring = ease(V.ring, t_ring, 18, dt);
    V.dots = ease(V.dots, t_dots, 5, dt);
    V.confused = ease(V.confused, t_confused, 8, dt);

    // The ring needs the whole screen; everything else lives in the face's
    // patch and the thought dots'.
    bool ring_on = V.ring > 0.02f;
    if (ring_on || ring_was_on) lv_obj_invalidate(lv_screen_active());
    else {
        static const lv_area_t patches[] = { { 110, 175, 356, 300 }, { 195, 30, 272, 62 } };
        for (size_t i = 0; i < sizeof patches / sizeof *patches; i++) lv_obj_invalidate_area(card, &patches[i]);
    }
    ring_was_on = ring_on;
}

static lv_obj_t *plain(lv_obj_t *parent) {
    lv_obj_t *o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_set_size(o, 466, 466);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    return o;
}

void face_start(void) {
    art_dsc.data = eugenia_rgb565_start;
    blush_dsc.data = blush_argb_start;

    lv_obj_t *screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    card = plain(screen);
    lv_obj_t *art = lv_image_create(card);
    lv_image_set_src(art, &art_dsc);
    lv_obj_remove_flag(art, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(plain(card), draw_face, LV_EVENT_DRAW_MAIN, NULL);
    lv_obj_add_flag(card, LV_OBJ_FLAG_HIDDEN);
    night = plain(screen);
    lv_obj_add_event_cb(night, draw_night, LV_EVENT_DRAW_MAIN, NULL);
    lv_obj_add_flag(night, LV_OBJ_FLAG_HIDDEN);

    // Started on the sleep screen, her face never shows.
    dark = mode == FACE_DARK;
    wander();
    lv_obj_remove_flag(dark ? night : card, LV_OBJ_FLAG_HIDDEN);

    uint32_t now = lv_tick_get();
    next_blink = now + 400;
    next_glance = now + 1500;
    lv_timer_create(tick, FACE_FRAME_MS, NULL);
}
