/* The face: her render as one still image, and her eyes, mouth and cheeks
   drawn live on top of it. Only the face's own patch of screen is redrawn on
   a frame, which is what keeps it smooth on this chip — the ring, which runs
   round the whole rim, is the one thing that redraws the full screen, and only
   while it is showing.

   The numbers are the playground's (claude.ai artifact "Eugenia, on the
   charm"), measured from each render, in pixels of the 466 x 466 screen. */
#include "face.h"

#include <math.h>
#include <stdint.h>
#include "esp_random.h"
#include "lvgl.h"

typedef struct {
    float eye_l[2], eye_r[2], rx, ry;
    float hl[3];                      // highlight dx, dy, radius
    float mouth[2], mouth_w, sag, stroke;
    float blush_l[2], blush_r[2];
} face_geometry_t;

static const face_geometry_t EUGENIA = {
    {168.9f, 230.0f}, {292.7f, 230.0f}, 12.59f, 13.5f,
    {7.8f, -7.3f, 2.7f},
    {231.9f, 254.6f}, 38.0f, 6.9f, 3.2f,
    {164.3f, 262.6f}, {301.7f, 262.6f},
};

static const face_geometry_t GLADYS = {
    {169.2f, 230.0f}, {292.4f, 230.0f}, 12.53f, 13.44f,
    {7.7f, -7.3f, 2.7f},
    {231.9f, 254.9f}, 37.8f, 6.8f, 3.2f,
    {164.7f, 263.1f}, {301.3f, 263.1f},
};

// Tunings from the playground's defaults.
#define BLINK_EVERY_MS  4000
#define LOOK_RANGE      6.0f
#define BLUSH           0.55f
#define FRAME_MS        33

extern const uint8_t eugenia_rgb565_start[] asm("_binary_eugenia_rgb565_start");
extern const uint8_t gladys_rgb565_start[]  asm("_binary_gladys_rgb565_start");
extern const uint8_t blush_argb_start[]     asm("_binary_blush_argb_start");

static lv_image_dsc_t base_dsc = {
    .header = { .magic = LV_IMAGE_HEADER_MAGIC, .cf = LV_COLOR_FORMAT_RGB565,
                .w = 466, .h = 466, .stride = 466 * 2 },
    .data_size = 466 * 466 * 2,
};

static lv_image_dsc_t blush_dsc = {
    .header = { .magic = LV_IMAGE_HEADER_MAGIC, .cf = LV_COLOR_FORMAT_ARGB8888,
                .w = 52, .h = 44, .stride = 52 * 4 },
    .data_size = 52 * 44 * 4,
};

static const face_geometry_t *F;
static lv_obj_t *base_obj, *layer_obj;

static volatile face_mode_t mode = FACE_IDLE;
static volatile float level;

// What is on screen, eased toward what the mode asks for.
static struct { float open, gx, gy, mouth, smile, blush, ring, dots, confused, happy; } V = { .open = 0, .smile = 1 };
static float gaze[2];
static uint32_t next_glance, next_blink, blink_at;
static float lid = 1;  // the blink, on top of how open the mode wants the eyes
static bool blinking, ring_was_on, was_done;
static float sweep = 1;  // how much of the ring is drawn, from the top
static bool dark;      // her face hidden: FACE_DARK or FACE_DOT
static face_mode_t shown;

static bool hides(face_mode_t m) { return m == FACE_DARK || m == FACE_DOT; }

void face_set_mode(face_mode_t m) { mode = m; }
void face_set_level(float l) { level = l < 0 ? 0 : l > 1 ? 1 : l; }

static float rnd(void) { return (float)esp_random() / 4294967295.0f; }

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

/* The dot that waits for him, the playground's: purple for Eugenia, the light
   silver of Gladys's fur at its brightest, since grey on black reads as a
   smudge. Low on the screen, with a glow. Still, so it stays on the panel
   while the chip sleeps. */
static void draw_dot(lv_layer_t *layer) {
    bool gladys = F == &GLADYS;
    lv_draw_rect_dsc_t d;
    lv_draw_rect_dsc_init(&d);
    d.bg_color = lv_color_hex(gladys ? 0xeeecf4 : 0xb45cd9);
    d.radius = LV_RADIUS_CIRCLE;
    d.shadow_color = lv_color_hex(gladys ? 0xe8e6f0 : 0x8b35b8);
    d.shadow_opa = gladys ? 190 : 230;
    d.shadow_width = 26;
    lv_area_t a = { 233 - 11, 404 - 11, 233 + 11, 404 + 11 };
    lv_draw_rect(layer, &d, &a);
}

/* Doji's purples, turning slowly round the rim: LVGL draws no conic gradient,
   so the ring is short arcs, each the colour of its place on the turn. */
static const uint32_t RING[] = { 0x5c40b0, 0x8b35b8, 0xb45cd9, 0x6a4fd0, 0x5c40b0 };
#define RING_STEPS 36

static void draw_ring(lv_layer_t *layer, int32_t width, float opa) {
    float turn = lv_tick_get() / 1800.0f;
    int steps = (int)ceilf(RING_STEPS * sweep);
    for (int i = 0; i < steps; i++) {
        float at = fmodf((float)i / RING_STEPS + turn, 1.0f) * 4;
        int k = (int)at;
        lv_draw_arc_dsc_t d;
        lv_draw_arc_dsc_init(&d);
        d.center.x = 233; d.center.y = 233;
        d.width = width;
        d.radius = 231 - width / 2;
        d.start_angle = (270 + i * 360 / RING_STEPS) % 360;
        d.end_angle = (271 + (i + 1) * 360 / RING_STEPS) % 360;  // a degree over: no seams
        d.color = lv_color_mix(lv_color_hex(RING[k + 1]), lv_color_hex(RING[k]),
                               (uint8_t)(255 * (at - k)));
        d.opa = (lv_opa_t)(255 * opa);
        lv_draw_arc(layer, &d);
    }
}

static void draw_face(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    const lv_color_t ink = lv_color_hex(0x0d0c0b);
    if (dark) {
        if (shown == FACE_DOT) draw_dot(layer);
        return;
    }

    // Cheeks
    for (int i = 0; i < 2; i++) {
        const float *c = i ? F->blush_r : F->blush_l;
        lv_draw_image_dsc_t d;
        lv_draw_image_dsc_init(&d);
        d.src = &blush_dsc;
        d.opa = (lv_opa_t)(255 * 0.62f * V.blush);
        lv_area_t a = { lroundf(c[0] - 26), lroundf(c[1] - 22), lroundf(c[0] + 25), lroundf(c[1] + 21) };
        lv_draw_image(layer, &d, &a);
    }

    // Eyes, a line when shut, with the highlight once open enough to hold it.
    // Confused, one is smaller and they sit at a tilt.
    for (int i = 0; i < 2; i++) {
        const float *c = i ? F->eye_r : F->eye_l;
        float odd = 1 + V.confused * (i ? 0.12f : -0.18f);
        float cx = c[0] + V.gx, cy = c[1] + V.gy + V.confused * (i ? -1.6f : 1.6f);
        float open = V.open * lid;
        float rx = F->rx * odd, ry = F->ry * odd * open;
        // Delighted, an eye is an arc, the playground's: a ring segment over it.
        if (V.happy > 0.5f) {
            draw_curve(layer, cx, cy, rx * 0.85f, -rx * 0.52f, 3.4f, ink);
            continue;
        }
        if (ry < 1.8f) {
            draw_curve(layer, cx, cy, rx * 0.9f, 1.2f, 2.6f, ink);
            continue;
        }
        dot(layer, cx, cy, rx, ry, ink, LV_OPA_COVER);
        if (open > 0.45f) {
            float k = open - 0.45f > 0.25f ? 1.0f : (open - 0.45f) * 4;
            dot(layer, cx + F->hl[0], cy + F->hl[1] * open, F->hl[2], F->hl[2],
                lv_color_hex(0xf2f0ec), (lv_opa_t)(235 * k));
        }
    }

    // Mouth: the smile, or open while she speaks.
    float mx = F->mouth[0], my = F->mouth[1];
    if (V.mouth < 0.06f) {
        draw_curve(layer, mx, my, F->mouth_w / 2, F->sag * V.smile, F->stroke, ink);
    } else {
        float half = F->mouth_w / 2 * 0.86f, h = V.mouth * 12.0f;
        lv_draw_rect_dsc_t d;
        lv_draw_rect_dsc_init(&d);
        d.bg_color = lv_color_hex(0x1d0e0b); d.radius = LV_RADIUS_CIRCLE;
        d.border_color = ink; d.border_width = 2; d.border_opa = LV_OPA_COVER;
        lv_area_t a = { lroundf(mx - half), lroundf(my - 1), lroundf(mx + half),
                        lroundf(my + F->sag * 0.8f + 2 * h) };
        lv_draw_rect(layer, &d, &a);
    }

    // Thought dots above her head, lighting up one after another.
    if (V.dots > 0.02f) {
        static const float at[3][3] = { { 208, 52, 3.2f }, { 233, 44, 3.8f }, { 258, 52, 3.2f } };
        uint32_t now = lv_tick_get();
        for (int i = 0; i < 3; i++) {
            float pulse = 0.5f + 0.5f * sinf(now / 260.0f - i * 1.1f);
            dot(layer, at[i][0], at[i][1] - pulse * 2.5f, at[i][2], at[i][2], lv_color_hex(0xead3b6),
                (lv_opa_t)(255 * V.dots * (0.25f + 0.75f * pulse)));
        }
    }

    // The ring on the rim: listening, it follows his voice; done, it sweeps in.
    if (V.ring > 0.02f) {
        bool listening = shown == FACE_LISTENING;
        int32_t width = listening ? 4 + (int32_t)(7 * V.ring) : 8;
        draw_ring(layer, width, listening ? 0.35f + 0.65f * V.ring : V.ring);
    }
}

static void tick(lv_timer_t *t) {
    (void)t;
    static uint32_t last;
    uint32_t now = lv_tick_get();
    float dt = last ? (float)(now - last) / 1000.0f : 0.033f;
    if (dt > 0.05f) dt = 0.05f;
    last = now;

    face_mode_t m = mode;

    // Into or out of the dark: the whole screen changes once, and on the way
    // out her eyes open from shut.
    if (hides(m) != dark || (dark && m != shown)) {
        dark = hides(m);
        if (dark) lv_obj_add_flag(base_obj, LV_OBJ_FLAG_HIDDEN);
        else lv_obj_remove_flag(base_obj, LV_OBJ_FLAG_HIDDEN);
        V.open = 0;
        lv_obj_invalidate(layer_obj);
    }
    shown = m;
    if (dark) return;

    float t_open = 1, t_mouth = 0, t_smile = 1, t_ring = 0, t_dots = 0, t_confused = 0, glance = 1;
    float t_happy = 0, t_blush = BLUSH;
    const float *fixed = NULL;
    static const float up[2] = { 0, -2 }, puzzled[2] = { 3, -2.5f }, rest[2] = { 0, 1 }, ahead[2] = { 0, 0 };
    // Thinking looks up to one side, then the other, every 1.7 seconds.
    float pondering[2] = { (now / 1700) % 2 ? -LOOK_RANGE * 0.55f : LOOK_RANGE * 0.9f, -LOOK_RANGE };
    if (m == FACE_LISTENING) { t_smile = 1.1f; t_ring = 0.25f + 0.75f * level; fixed = up; }
    if (m == FACE_SPEAKING)  { t_mouth = level; t_smile = 0.9f; glance = 0.4f; }
    if (m == FACE_THINKING)  { t_open = 0.85f; t_smile = 0.25f; t_dots = 1; fixed = pondering; }
    if (m == FACE_CONFUSED)  { t_smile = -0.35f; t_confused = 1; fixed = puzzled; }
    if (m == FACE_DONE)      { t_smile = 1.1f; t_ring = 1; fixed = ahead; }
    if (m == FACE_HAPPY)     { t_smile = 1.6f; t_ring = 1; t_happy = 1; t_blush = BLUSH + 0.35f; fixed = ahead; }
    if (m == FACE_ASLEEP)    { t_open = 0; t_smile = 0.6f; fixed = rest; }

    // Done, the ring sweeps round once from the top in 700 ms; otherwise it is whole.
    static uint32_t done_at;
    bool done = m == FACE_DONE || m == FACE_HAPPY;
    if (done && !was_done) done_at = now;
    was_done = done;
    sweep = done ? fminf(1, (now - done_at) / 700.0f) : 1;

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
    V.happy = ease(V.happy, t_happy, 10, dt);
    V.ring = ease(V.ring, t_ring, 18, dt);
    V.dots = ease(V.dots, t_dots, 5, dt);
    V.confused = ease(V.confused, t_confused, 8, dt);

    // The ring needs the rim; everything else lives in the face's patch.
    bool ring_on = V.ring > 0.02f;
    if (ring_on || ring_was_on) lv_obj_invalidate(layer_obj);
    else {
        lv_area_t a = { 110, 175, 356, 300 };
        lv_obj_invalidate_area(layer_obj, &a);
        if (V.dots > 0.01f) {
            lv_area_t d = { 195, 30, 272, 62 };
            lv_obj_invalidate_area(layer_obj, &d);
        }
    }
    ring_was_on = ring_on;
}

void face_start(bool gladys) {
    F = gladys ? &GLADYS : &EUGENIA;
    base_dsc.data = gladys ? gladys_rgb565_start : eugenia_rgb565_start;
    blush_dsc.data = blush_argb_start;

    lv_obj_t *screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0);

    base_obj = lv_image_create(screen);
    lv_image_set_src(base_obj, &base_dsc);
    lv_obj_set_pos(base_obj, 0, 0);
    lv_obj_remove_flag(base_obj, LV_OBJ_FLAG_CLICKABLE);
    dark = hides(mode);
    shown = mode;
    if (dark) lv_obj_add_flag(base_obj, LV_OBJ_FLAG_HIDDEN);

    layer_obj = lv_obj_create(screen);
    lv_obj_remove_style_all(layer_obj);
    lv_obj_set_size(layer_obj, 466, 466);
    lv_obj_set_pos(layer_obj, 0, 0);
    lv_obj_remove_flag(layer_obj, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_event_cb(layer_obj, draw_face, LV_EVENT_DRAW_MAIN, NULL);

    uint32_t now = lv_tick_get();
    next_blink = now + 400;
    next_glance = now + 1500;
    lv_timer_create(tick, FRAME_MS, NULL);
}
