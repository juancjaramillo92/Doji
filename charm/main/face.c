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
static lv_obj_t *layer_obj;

static volatile face_mode_t mode = FACE_IDLE;
static volatile float level;

// What is on screen, eased toward what the mode asks for.
static struct { float open, gx, gy, mouth, smile, blush, ring; } V = { .open = 0, .smile = 1 };
static float gaze[2];
static uint32_t next_glance, next_blink, blink_at;
static float lid = 1;  // the blink, on top of how open the mode wants the eyes
static bool blinking, ring_was_on;

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

static void draw_face(lv_event_t *e) {
    lv_layer_t *layer = lv_event_get_layer(e);
    const lv_color_t ink = lv_color_hex(0x0d0c0b);

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
    for (int i = 0; i < 2; i++) {
        const float *c = i ? F->eye_r : F->eye_l;
        float cx = c[0] + V.gx, cy = c[1] + V.gy;
        float open = V.open * lid;
        float rx = F->rx, ry = F->ry * open;
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

    // The listening ring, on the rim.
    if (V.ring > 0.02f) {
        lv_draw_arc_dsc_t d;
        lv_draw_arc_dsc_init(&d);
        d.center.x = 233; d.center.y = 233;
        d.width = 4 + (int32_t)(7 * V.ring);
        d.radius = 231 - d.width / 2;
        d.start_angle = 0; d.end_angle = 360;
        d.color = lv_color_hex(0x8b35b8);
        d.opa = (lv_opa_t)(255 * (0.35f + 0.65f * V.ring));
        lv_draw_arc(layer, &d);
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
    float t_open = 1, t_mouth = 0, t_smile = 1, t_ring = 0, glance = 1;
    const float *fixed = NULL;
    static const float up[2] = { 0, -2 };
    if (m == FACE_LISTENING) { t_smile = 1.1f; t_ring = 0.25f + 0.75f * level; fixed = up; }
    if (m == FACE_SPEAKING)  { t_mouth = level; t_smile = 0.9f; glance = 0.4f; }

    // Glances: a quick jump to a point, held for a moment.
    if (fixed) { gaze[0] = fixed[0]; gaze[1] = fixed[1]; }
    else if ((int32_t)(now - next_glance) >= 0) {
        float a = rnd() * 2 * (float)M_PI, r = sqrtf(rnd()) * LOOK_RANGE * glance;
        gaze[0] = cosf(a) * r; gaze[1] = sinf(a) * r * 0.7f;
        next_glance = now + 1200 + (uint32_t)(rnd() * 2800);
    }

    // Blinks: shut in 70 ms, open in 90.
    lid = 1;
    if (!blinking && (int32_t)(now - next_blink) >= 0) { blinking = true; blink_at = now; }
    if (blinking) {
        uint32_t b = now - blink_at;
        lid = b < 70 ? 1 - b / 70.0f : b < 160 ? (b - 70) / 90.0f : 1;
        if (b >= 160) {
            blinking = false;
            next_blink = now + (uint32_t)(BLINK_EVERY_MS * (0.6f + rnd() * 0.8f));
        }
    }

    V.open = ease(V.open, t_open, 16, dt);
    V.gx = ease(V.gx, gaze[0], 22, dt);
    V.gy = ease(V.gy, gaze[1], 22, dt);
    V.mouth = ease(V.mouth, t_mouth, 28, dt);
    V.smile = ease(V.smile, t_smile, 10, dt);
    V.blush = ease(V.blush, BLUSH, 4, dt);
    V.ring = ease(V.ring, t_ring, 18, dt);

    // The ring needs the rim; everything else lives in the face's patch.
    bool ring_on = V.ring > 0.02f;
    if (ring_on || ring_was_on) lv_obj_invalidate(layer_obj);
    else {
        lv_area_t a = { 110, 175, 356, 300 };
        lv_obj_invalidate_area(layer_obj, &a);
    }
    ring_was_on = ring_on;
}

void face_start(bool gladys) {
    F = gladys ? &GLADYS : &EUGENIA;
    base_dsc.data = gladys ? gladys_rgb565_start : eugenia_rgb565_start;
    blush_dsc.data = blush_argb_start;

    lv_obj_t *screen = lv_screen_active();
    lv_obj_set_style_bg_color(screen, lv_color_black(), 0);

    lv_obj_t *img = lv_image_create(screen);
    lv_image_set_src(img, &base_dsc);
    lv_obj_set_pos(img, 0, 0);
    lv_obj_remove_flag(img, LV_OBJ_FLAG_CLICKABLE);

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
