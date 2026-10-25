/* The face: Eugenia as her glass, breathing, with bubbles rising in it, her
   eyes and mouth drawn live on top. The glass is one of glass.c's renders,
   drawn as it is and never transformed, and the face rides it. Only what
   changes is redrawn on a frame, which is what keeps it smooth on this chip:
   her face's patch, each bubble's own, and the whole of her glass only when
   its render changes, its light moves a step or a glint crosses it. The ring
   is the only thing that redraws the full screen, and only while it shows.
   The serial log says every few seconds how long the frames took, so the
   real board says whether they keep time.

   The sleep screen is a layer over her: black but for its marks.

   The numbers are measured from the drawing of her face over the render, in
   pixels of the 466 x 466 screen, with her glass at rest. */
#include "face.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <time.h>
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "glass.h"
#include "lvgl.h"
#include "net.h"
#include "palette.h"

LV_FONT_DECLARE(hanken_36);

static const char *TAG = "face";

typedef struct {
    float eye_l[2], eye_r[2], rx, ry;
    float hl[3];                      // highlight dx, dy, radius
    float mouth[2], mouth_w, sag, stroke;
    float tilt;                       // degrees; her head leans, the right side higher
} face_geometry_t;

static const face_geometry_t F = {
    {188.8f, 162.0f}, {286.7f, 146.6f}, 8.8f, 9.0f,
    {4.3f, -2.6f, 1.8f},
    {244.3f, 176.2f}, 51.0f, 9.4f, 3.4f,
    -10.0f,
};

// How she moves, tuned by eye.
#define BLINK_EVERY_MS  4000
#define LOOK_RANGE      6.0f
#define SHIFT_X         8     // how far the sleep screen's marks wander, so none burns in
#define SHIFT_Y         4
#define WINK_ONE_IN     12    // of her blinks while idle, one in this many a wink
#define WIDEN_MS        700   // waking, her eyes open wide, then settle
#define HAPPY_MS        900   // tapped, her eyes smile
#define YAWN_MS         800   // late, her goodnight starts with a yawn
#define LATE_FROM       23    // the hours she is sleepy in, by her clock
#define LATE_UNTIL      6
#define FOLLOW_ONE_IN   3     // of her glances while idle, one in this many follows a bubble
#define FOLLOW_MS       2500
#define FOLLOW_GAIN     0.05f // how far her eyes turn toward the bubble she follows, a pixel's worth per pixel away
#define SHEEN_MS        1100  // a glint crossing her glass
#define SHEEN_EVERY_MS  25000 // about how often, while she idles, after the one she wakes with
#define BREATH          0.009f // her breath, as a squash toward stretched: her top rises three pixels
#define GLOW_OPA        150   // her light at its brightest, inside her
#define GLOW_STEPS      16    // its levels: her glass is redrawn only when it moves one
#define BUBBLE_OPA      230
#define LOG_MS          5000  // how often the serial log says how her frames kept time

extern const uint8_t body_rgb565_start[] asm("_binary_body_rgb565_start");
extern const uint8_t glow_a8_start[] asm("_binary_glow_a8_start");
extern const uint8_t bubbles_argb8888_start[] asm("_binary_bubbles_argb8888_start");

// Her renders, her light and the bubbles' sprites, as the bytes art.py made.
static lv_image_dsc_t body[GLASS_FRAMES], glow, bubble[GLASS_SIZES][GLASS_PHASES * GLASS_PHASES];

static lv_obj_t *card, *night;

static volatile face_mode_t mode = FACE_IDLE;
static volatile float level, hold, jolted, tilt[2] = { 0, -0.9f };
static volatile bool briefing_waits, trade_waits, low, offline, tapped;
static volatile int charge = -1;

// What is on screen, eased toward what the mode asks for.
static struct { float open, gx, gy, mouth, smile, ring, dots, confused, happy, glow, stir, up[2]; } V = {
    .open = 0, .smile = 1, .up = { 0, -0.9f },
};
static float gaze[2];
static uint32_t next_glance, next_blink, blink_at, woke_at, happy_until, follow_until, sheen_at, sheen_next;
static float lid[2] = { 1, 1 };  // the blink, on top of how open the mode wants the eyes; a wink is one
static int winking = -1, following = -1;
static bool blinking, ring_was_on, sheening, sleepy;
static bool dark;
static int shift[2];

/* Her glass, and what the next frame draws of it, worked out by tick: the
   render, its light's step, each bubble's sprite and place, and the glint. */
static glass_t G;
static lv_area_t crop;  // GLASS_CROP, as LVGL takes an area
static int frame, glow_step;
static struct { lv_area_t at; const lv_image_dsc_t *src; lv_opa_t opa; } seen[GLASS_BUBBLES];
static float sheen[4];
static lv_opa_t sheen_opa;

void face_set_mode(face_mode_t m) { mode = m; }
face_mode_t face_get_mode(void) { return mode; }
void face_set_level(float l) { level = l < 0 ? 0 : l > 1 ? 1 : l; }
void face_set_hold(float h) { hold = h < 0 ? 0 : h > 1 ? 1 : h; }
void face_set_tilt(float x, float y) { tilt[0] = x; tilt[1] = y; }
void face_tap(void) { tapped = true; }
void face_jolt(float strength) { if (strength > jolted) jolted = strength; }
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

// Late at night by her clock, once the internet has set it.
static bool late(void) {
    time_t now = time(NULL);
    struct tm t;
    localtime_r(&now, &t);
    return now >= CLOCK_SET && (t.tm_hour >= LATE_FROM || t.tm_hour < LATE_UNTIL);
}

/* A smile through its two ends and its lowest point, as an arc of the circle
   those three points lie on — LVGL draws arcs anti-aliased, and at this size
   the arc and a quadratic curve are the same line. A frown is
   the same circle below; a straight mouth is a line. Turned through F.tilt
   about (cx, y), with her head. */
static void draw_curve(lv_layer_t *layer, float cx, float y, float half, float sag,
                       float width, lv_color_t color) {
    float t = F.tilt * (float)M_PI / 180.0f, c = cosf(t), sn = sinf(t);
    if (fabsf(sag) < 0.6f) {
        lv_draw_line_dsc_t d;
        lv_draw_line_dsc_init(&d);
        d.p1.x = cx - half * c; d.p1.y = y - half * sn; d.p2.x = cx + half * c; d.p2.y = y + half * sn;
        d.width = width; d.round_start = 1; d.round_end = 1; d.color = color;
        lv_draw_line(layer, &d);
        return;
    }
    float s = fabsf(sag), r = (half * half + s * s) / (2 * s);
    float dy = sag > 0 ? sag - r : sag + r;  // the circle's centre below (cx, y), untilted
    float a_r = atan2f(-dy, half) * 180.0f / (float)M_PI + F.tilt;
    float a_l = atan2f(-dy, -half) * 180.0f / (float)M_PI + F.tilt;
    if (a_r < 0) a_r += 360;
    if (a_l < 0) a_l += 360;
    lv_draw_arc_dsc_t d;
    lv_draw_arc_dsc_init(&d);
    d.center.x = (int32_t)lroundf(cx - dy * sn); d.center.y = (int32_t)lroundf(y + dy * c);
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
    const lv_color_t ink = lv_color_hex(0x0d0c0b);

    // Her glass as the render that shows, then the light inside it and the
    // bubbles, under her eyes and mouth, which sit on its surface.
    lv_draw_image_dsc_t img;
    lv_draw_image_dsc_init(&img);
    img.src = &body[frame];
    lv_draw_image(layer, &img, &crop);
    if (glow_step) {
        lv_draw_image_dsc_init(&img);
        img.src = &glow;
        img.recolor = lv_color_hex(GLOW);
        img.opa = (lv_opa_t)(GLOW_OPA * glow_step / GLOW_STEPS);
        lv_draw_image(layer, &img, &crop);
    }
    for (int i = 0; i < GLASS_BUBBLES; i++) {
        if (!seen[i].opa) continue;
        lv_draw_image_dsc_init(&img);
        img.src = seen[i].src;
        img.opa = seen[i].opa;
        lv_draw_image(layer, &img, &seen[i].at);
    }

    // The glint: a soft streak, widest and faintest outside.
    if (sheen_opa) {
        static const float strokes[3][2] = { { 48, 0.08f }, { 26, 0.1f }, { 10, 0.13f } };
        lv_draw_line_dsc_t l;
        lv_draw_line_dsc_init(&l);
        l.p1.x = sheen[0]; l.p1.y = sheen[1]; l.p2.x = sheen[2]; l.p2.y = sheen[3];
        l.round_start = 1; l.round_end = 1; l.color = lv_color_hex(0xf2f0ec);
        for (int i = 0; i < 3; i++) {
            l.width = (int32_t)strokes[i][0];
            l.opa = (lv_opa_t)(sheen_opa * strokes[i][1]);
            lv_draw_line(layer, &l);
        }
    }

    // Eyes, a line when shut, with the highlight once open enough to hold it.
    // Confused, one is smaller and they sit at a tilt; smiling, each shut eye
    // arches; winking, one shuts alone.
    float scale[2], at[2];
    glass_scale(frame, scale);
    for (int i = 0; i < 2; i++) {
        const float *eye = i ? F.eye_r : F.eye_l;
        float open = V.open * lid[i] * (1 - V.happy);
        float odd = 1 + V.confused * (i ? 0.12f : -0.18f);
        glass_place(frame, eye[0] + V.gx, eye[1] + V.gy + V.confused * (i ? -1.6f : 1.6f), at);
        float rx = F.rx * odd * scale[0], ry = F.ry * odd * open * scale[1];
        if (ry < 1.8f) {
            draw_curve(layer, at[0], at[1], rx * 0.9f, 1.2f - 4.6f * V.happy, 2.6f, ink);
            continue;
        }
        dot(layer, at[0], at[1], rx, ry, ink, LV_OPA_COVER);
        if (open > 0.45f) {
            float k = open - 0.45f > 0.25f ? 1.0f : (open - 0.45f) * 4;
            dot(layer, at[0] + F.hl[0], at[1] + F.hl[1] * fminf(1, open), F.hl[2], F.hl[2],
                lv_color_hex(0xf2f0ec), (lv_opa_t)(235 * k));
        }
    }

    // Mouth: the smile, or open while she speaks, or yawns.
    glass_place(frame, F.mouth[0], F.mouth[1], at);
    float mx = at[0], my = at[1];
    if (V.mouth < 0.06f) {
        draw_curve(layer, mx, my, F.mouth_w / 2 * scale[0], F.sag * V.smile * scale[1], F.stroke, ink);
    } else {
        float half = F.mouth_w / 2 * 0.86f * scale[0], h = V.mouth * 12.0f * scale[1];
        lv_draw_rect_dsc_t d;
        lv_draw_rect_dsc_init(&d);
        d.bg_color = lv_color_hex(0x1d0e0b); d.radius = LV_RADIUS_CIRCLE;
        d.border_color = ink; d.border_width = 2; d.border_opa = LV_OPA_COVER;
        lv_area_t a = { lroundf(mx - half), lroundf(my - 1), lroundf(mx + half),
                        lroundf(my + F.sag * 0.8f * scale[1] + 2 * h) };
        lv_draw_rect(layer, &d, &a);
    }

    // Thought dots above her head, lighting up one after another.
    if (V.dots > 0.02f) {
        static const float dots[3][3] = { { 208, 52, 3.2f }, { 233, 44, 3.8f }, { 258, 52, 3.2f } };
        uint32_t now = lv_tick_get();
        for (int i = 0; i < 3; i++) {
            float pulse = 0.5f + 0.5f * sinf(now / 260.0f - i * 1.1f);
            glass_place(frame, dots[i][0], dots[i][1] - pulse * 2.5f, at);
            dot(layer, at[0], at[1], dots[i][2], dots[i][2], lv_color_hex(0xead3b6),
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

// A patch of her at rest, invalidated where a render puts it, a pixel or two over.
static void invalidate_placed(const lv_area_t *rest, int f) {
    float a[2], b[2];
    glass_place(f, rest->x1, rest->y1, a);
    glass_place(f, rest->x2, rest->y2, b);
    lv_area_t at = { (int32_t)floorf(a[0]) - 2, (int32_t)floorf(a[1]) - 2, (int32_t)ceilf(b[0]) + 2, (int32_t)ceilf(b[1]) + 2 };
    lv_obj_invalidate_area(card, &at);
}

// Her face appearing: eyes opening wide, a glint as she wakes.
static void wake(uint32_t now) {
    woke_at = now;
    sheen_at = now + 350;
    sheening = true;
    sleepy = late();
    glass_start(&G, esp_random());
}

/* How long the frames took, from LVGL starting to render to its last area
   handed to the panel: the panel takes that one as the next starts. Said
   every LOG_MS, and whenever her mode changes, under the mode it was. */
static int64_t render_from, slowest, total;
static int frames;

static void on_render(lv_event_t *e) {
    int64_t t = esp_timer_get_time();
    if (lv_event_get_code(e) == LV_EVENT_RENDER_START) { render_from = t; return; }
    frames++;
    total += t - render_from;
    if (t - render_from > slowest) slowest = t - render_from;
}

static void say_frames(face_mode_t m, uint32_t ms) {
    static const char *const MODES[] = { "idle", "listening", "speaking", "thinking", "confused", "asleep", "dark" };
    if (frames) {
        ESP_LOGI(TAG, "%s: %d frames in %lu ms, %d ms on average, %d ms the slowest",
                 MODES[m], frames, (unsigned long)ms, (int)(total / frames / 1000), (int)(slowest / 1000));
    }
    frames = 0;
    total = slowest = 0;
}

static void tick(lv_timer_t *t) {
    (void)t;
    static uint32_t last;
    uint32_t now = lv_tick_get();
    float dt = last ? (float)(now - last) / 1000.0f : 0.033f;
    if (dt > 0.05f) dt = 0.05f;
    last = now;

    face_mode_t m = mode;

    static face_mode_t was = FACE_DARK;
    static uint32_t since, said;
    if (m != was || now - said >= LOG_MS) {
        say_frames(was, now - said);
        said = now;
    }
    if (m != was) { was = m; since = now; }

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
            wake(now);
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
        tapped = false;
        jolted = 0;
        return;
    }
    static uint32_t asked;
    if (now - asked >= 1000) { asked = now; sleepy = late(); }

    // A tap she likes, a jolt she only feels: either wobbles her glass, and
    // a jolt stirs the bubbles.
    if (tapped) {
        tapped = false;
        glass_poke(&G, 0.7f);
        if (m == FACE_IDLE) happy_until = now + HAPPY_MS;
    }
    float jolt = jolted;
    if (jolt > 0) {
        jolted = 0;
        glass_poke(&G, jolt);
        if (jolt > V.stir) V.stir = jolt;
    }
    V.stir = ease(V.stir, 0, 1.5f, dt);
    V.up[0] = ease(V.up[0], tilt[0], 5, dt);
    V.up[1] = ease(V.up[1], tilt[1], 5, dt);

    float t_open = 1, t_mouth = 0, t_smile = 1, t_ring = 0, t_dots = 0, t_confused = 0, t_happy = 0, t_glow = 0, glance = 1;
    glass_mood_t mood = { .up = { V.up[0], V.up[1] }, .rise = 26, .every = 1.6f, .most = 6, .stir = V.stir,
                          .depth = BREATH, .period = sleepy ? 5.5f : 4.2f };
    const float *fixed = NULL;
    static const float up[2] = { 0, -2 }, puzzled[2] = { 3, -2.5f }, rest[2] = { 0, 1 };
    // Thinking looks up to one side, then the other, every 1.7 seconds.
    float pondering[2] = { (now / 1700) % 2 ? -LOOK_RANGE * 0.55f : LOOK_RANGE * 0.9f, -LOOK_RANGE };
    // Listening, she holds her breath and his voice stirs her bubbles.
    if (m == FACE_LISTENING) {
        t_smile = 1.1f; t_ring = 0.25f + 0.75f * level; fixed = up;
        mood.depth = 0; mood.stir = fmaxf(V.stir, level); mood.every = 1.2f; mood.most = 8;
    }
    // Speaking, her voice lights her and sends bubbles up as it swells.
    if (m == FACE_SPEAKING) {
        t_mouth = level; t_smile = 0.9f; glance = 0.4f; t_glow = 0.3f + 0.7f * level;
        mood.depth = 0.0065f; mood.period = 3.4f; mood.every = 0.4f + 1.2f * (1 - level); mood.most = 9;
    }
    // Thinking, a quick stream of them.
    if (m == FACE_THINKING) {
        t_open = 0.85f; t_smile = 0.25f; t_dots = 1; fixed = pondering;
        mood.rise = 48; mood.every = 0.35f; mood.most = GLASS_BUBBLES; mood.depth = 0.0045f; mood.period = 2.6f;
    }
    if (m == FACE_CONFUSED) {
        t_smile = -0.35f; t_confused = 1; fixed = puzzled;
        mood.rise = 14; mood.every = 2.5f; mood.most = 4; mood.depth = 0;
    }
    // Going to sleep, the last bubbles drift up, and late she yawns first.
    if (m == FACE_ASLEEP) {
        t_open = 0; t_smile = 0.6f; fixed = rest;
        mood.rise = 12; mood.every = 60; mood.depth = 0.003f; mood.period = 5.5f;
        if (sleepy && now - since < YAWN_MS) t_mouth = 0.9f * sinf((float)M_PI * (now - since) / YAWN_MS);
    }
    if (m == FACE_IDLE) {
        if (sleepy) { t_open = 0.8f; glance = 0.6f; }
        if ((int32_t)(happy_until - now) > 0) t_happy = 1;
    }
    if (now - woke_at < WIDEN_MS && t_open >= 1) t_open = 1.18f;

    glass_step(&G, &mood, dt);
    int was_frame = frame;
    frame = glass_frame(&G);

    // Glances: a quick jump to a point, held for a moment, the downhill side
    // favoured when she is tilted; or now and then a bubble, followed up.
    glass_bubble_t *chased = following >= 0 ? &G.bubbles[following] : NULL;
    if (fixed) {
        gaze[0] = fixed[0]; gaze[1] = fixed[1];
        following = -1;
    } else if (chased && chased->state == GLASS_RISING && (int32_t)(follow_until - now) > 0) {
        float eyes[2] = { (F.eye_l[0] + F.eye_r[0]) / 2, (F.eye_l[1] + F.eye_r[1]) / 2 }, at[2];
        glass_place(frame, chased->x, chased->y, at);
        float dx = (at[0] - eyes[0]) * FOLLOW_GAIN, dy = (at[1] - eyes[1]) * FOLLOW_GAIN, r = hypotf(dx, dy);
        float k = r > LOOK_RANGE ? LOOK_RANGE / r : 1;
        gaze[0] = dx * k; gaze[1] = dy * k * 0.7f;
    } else if ((int32_t)(now - next_glance) >= 0) {
        following = -1;
        int from = (int)(rnd() * GLASS_BUBBLES);
        for (int i = 0; m == FACE_IDLE && rnd() < 1.0f / FOLLOW_ONE_IN && i < GLASS_BUBBLES; i++) {
            int b = (from + i) % GLASS_BUBBLES;
            if (G.bubbles[b].state == GLASS_RISING) { following = b; break; }
        }
        if (following >= 0) {
            follow_until = now + FOLLOW_MS;
        } else {
            float a = rnd() * 2 * (float)M_PI, r = sqrtf(rnd()) * LOOK_RANGE * glance;
            gaze[0] = cosf(a) * r - V.up[0] * LOOK_RANGE * 0.5f;
            gaze[1] = sinf(a) * r * 0.7f;
        }
        next_glance = now + 1200 + (uint32_t)(rnd() * 2800);
    }

    // Blinks: shut in 70 ms, open in 90. Now and then, idle, a wink: one eye,
    // slower, held a moment, with a smile.
    if (!blinking && m != FACE_ASLEEP && (int32_t)(now - next_blink) >= 0) {
        blinking = true;
        blink_at = now;
        winking = m == FACE_IDLE && rnd() < 1.0f / WINK_ONE_IN ? rnd() < 0.5f : -1;
    }
    lid[0] = lid[1] = 1;
    if (blinking) {
        uint32_t b = now - blink_at, shut = winking < 0 ? 70 : 90, shut_for = winking < 0 ? 0 : 140,
                 opening = winking < 0 ? 90 : 120;
        float l = b < shut ? 1 - b / (float)shut : b < shut + shut_for ? 0 :
                  b < shut + shut_for + opening ? (b - shut - shut_for) / (float)opening : 1;
        if (winking != 1) lid[0] = l;
        if (winking != 0) lid[1] = l;
        if (winking >= 0) t_smile += 0.3f;
        if (b >= shut + shut_for + opening) {
            blinking = false;
            next_blink = now + (uint32_t)(BLINK_EVERY_MS * (sleepy ? 1.5f : 1) * (0.6f + rnd() * 0.8f));
        }
    }

    V.open = ease(V.open, t_open, m == FACE_ASLEEP ? 3 : 16, dt);
    V.gx = ease(V.gx, gaze[0], 22, dt);
    V.gy = ease(V.gy, gaze[1], 22, dt);
    V.mouth = ease(V.mouth, t_mouth, 28, dt);
    V.smile = ease(V.smile, t_smile, 10, dt);
    V.ring = ease(V.ring, t_ring, 18, dt);
    V.dots = ease(V.dots, t_dots, 5, dt);
    V.confused = ease(V.confused, t_confused, 8, dt);
    V.happy = ease(V.happy, t_happy, 12, dt);
    V.glow = ease(V.glow, t_glow, 4, dt);

    // The glint: as she wakes, then now and then while she idles, never
    // over her light or a wobble. It sweeps across her, down to the right.
    if (!sheening && m == FACE_IDLE && (int32_t)(now - sheen_next) >= 0 && V.glow < 0.02f && fabsf(G.give) < 0.05f) {
        sheening = true;
        sheen_at = now;
    }
    lv_opa_t sheen_was = sheen_opa;
    sheen_opa = 0;
    if (sheening && (int32_t)(now - sheen_at) >= 0) {
        float p = (now - sheen_at) / (float)SHEEN_MS, ends[4];
        static const float across[2] = { 0.8f, 0.6f };
        float x = GLASS_CROP[0] + GLASS_CROP[2] / 2.0f + across[0] * (340 * p - 170);
        float y = GLASS_CROP[1] + GLASS_CROP[3] / 2.0f + across[1] * (340 * p - 170);
        if (p >= 1) {
            sheening = false;
            sheen_next = now + (uint32_t)(SHEEN_EVERY_MS * (0.6f + rnd() * 0.8f));
        } else if (glass_chord(x, y, -across[1], across[0], 18, ends)) {
            glass_place(frame, ends[0], ends[1], sheen);
            glass_place(frame, ends[2], ends[3], sheen + 2);
            sheen_opa = (lv_opa_t)(255 * sinf((float)M_PI * p));
        }
    }

    // What the next frame draws of the bubbles.
    lv_area_t before[GLASS_BUBBLES];
    lv_opa_t was_shown[GLASS_BUBBLES];
    for (int i = 0; i < GLASS_BUBBLES; i++) {
        glass_bubble_t *b = &G.bubbles[i];
        before[i] = seen[i].at;
        was_shown[i] = seen[i].opa;
        seen[i].opa = b->state == GLASS_NONE ? 0 : (lv_opa_t)(BUBBLE_OPA * fmaxf(0, b->shown));
        if (!seen[i].opa) continue;
        float at[2];
        glass_place(frame, b->x, b->y, at);
        int side = GLASS_SIDE[b->size], x = (int)floorf(at[0]), y = (int)floorf(at[1]);
        int px = (int)((at[0] - x) * GLASS_PHASES), py = (int)((at[1] - y) * GLASS_PHASES);
        seen[i].src = &bubble[b->size][(py < GLASS_PHASES ? py : GLASS_PHASES - 1) * GLASS_PHASES +
                                       (px < GLASS_PHASES ? px : GLASS_PHASES - 1)];
        seen[i].at = (lv_area_t){ x - side / 2, y - side / 2, x - side / 2 + side - 1, y - side / 2 + side - 1 };
    }
    int step = (int)lroundf(V.glow * GLOW_STEPS);
    bool whole = frame != was_frame || step != glow_step || sheen_opa || sheen_was;
    glow_step = step;

    /* The ring needs the whole screen, and her glass all of its patch when its
       render, its light or the glint changes; otherwise her face's patch and
       the thought dots', placed on the render, and each bubble's, where it
       was and where it is. */
    static const lv_area_t face_patch = { 150, 108, 326, 232 }, dots_patch = { 195, 30, 272, 62 };
    bool ring_on = V.ring > 0.02f;
    if (ring_on || ring_was_on) {
        lv_obj_invalidate(lv_screen_active());
    } else if (whole) {
        lv_obj_invalidate_area(card, &crop);
        invalidate_placed(&dots_patch, was_frame);
        invalidate_placed(&dots_patch, frame);
    } else {
        invalidate_placed(&face_patch, frame);
        invalidate_placed(&dots_patch, frame);
        for (int i = 0; i < GLASS_BUBBLES; i++) {
            if (was_shown[i]) lv_obj_invalidate_area(card, &before[i]);
            if (seen[i].opa) lv_obj_invalidate_area(card, &seen[i].at);
        }
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

static void image(lv_image_dsc_t *d, lv_color_format_t cf, int w, int h, int bytes, const uint8_t *data) {
    d->header = (lv_image_header_t){ .magic = LV_IMAGE_HEADER_MAGIC, .cf = cf, .w = w, .h = h, .stride = w * bytes };
    d->data_size = w * h * bytes;
    d->data = data;
}

void face_start(void) {
    for (int f = 0; f < GLASS_FRAMES; f++) {
        image(&body[f], LV_COLOR_FORMAT_RGB565, GLASS_CROP[2], GLASS_CROP[3], 2,
              body_rgb565_start + (size_t)f * GLASS_CROP[2] * GLASS_CROP[3] * 2);
    }
    image(&glow, LV_COLOR_FORMAT_A8, GLASS_CROP[2], GLASS_CROP[3], 1, glow_a8_start);
    const uint8_t *sprite = bubbles_argb8888_start;
    for (int s = 0; s < GLASS_SIZES; s++) {
        for (int p = 0; p < GLASS_PHASES * GLASS_PHASES; p++) {
            image(&bubble[s][p], LV_COLOR_FORMAT_ARGB8888, GLASS_SIDE[s], GLASS_SIDE[s], 4, sprite);
            sprite += GLASS_SIDE[s] * GLASS_SIDE[s] * 4;
        }
    }
    crop = (lv_area_t){ GLASS_CROP[0], GLASS_CROP[1], GLASS_CROP[0] + GLASS_CROP[2] - 1, GLASS_CROP[1] + GLASS_CROP[3] - 1 };
    frame = glass_frame(&G);  // at rest, until she wakes

    lv_obj_t *screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);

    card = plain(screen);
    lv_obj_add_event_cb(card, draw_face, LV_EVENT_DRAW_MAIN, NULL);
    lv_obj_add_flag(card, LV_OBJ_FLAG_HIDDEN);
    night = plain(screen);
    lv_obj_add_event_cb(night, draw_night, LV_EVENT_DRAW_MAIN, NULL);
    lv_obj_add_flag(night, LV_OBJ_FLAG_HIDDEN);

    lv_display_t *display = lv_display_get_default();
    lv_display_add_event_cb(display, on_render, LV_EVENT_RENDER_START, NULL);
    lv_display_add_event_cb(display, on_render, LV_EVENT_RENDER_READY, NULL);

    // Started on the sleep screen, her face never shows.
    uint32_t now = lv_tick_get();
    dark = mode == FACE_DARK;
    wander();
    if (!dark) wake(now);
    lv_obj_remove_flag(dark ? night : card, LV_OBJ_FLAG_HIDDEN);

    next_blink = now + 400;
    next_glance = now + 1500;
    sheen_next = now + SHEEN_EVERY_MS;
    lv_timer_create(tick, FACE_FRAME_MS, NULL);
}
