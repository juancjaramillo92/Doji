#include "glass.h"

#include <math.h>

/* How she moves, tuned by eye until the real board says otherwise. */
#define BOUNCE_HZ 2.2f    // the wobble's own frequency
#define DAMPING   0.18f   // of critical: a few bounces, then rest
#define POKE      1.1f    // squash a second, from a full poke: enough, past the damping, to reach the furthest render
#define DEEPEN    2.0f    // how fast a breath's depth eases toward the mood's, a second
#define SWAY_PX   7.0f    // how fast a bubble sways, in pixels a second, still
#define STIR_PX   40.0f   // and more when stirred
#define FOLLOW    3.0f    // how fast a bubble's speed eases toward its rise, a second
#define FADE_IN   3.0f    // shown a second, as it starts
#define FADE_OUT  6.0f    // and as it pops
#define TRIES     12      // places tried for a new bubble

// Her middle at rest: a new bubble starts below it, as up has it.
static float centre[2];

static float rnd(glass_t *g) {
    g->seed ^= g->seed << 13;
    g->seed ^= g->seed >> 17;
    g->seed ^= g->seed << 5;
    return (float)(g->seed >> 8) / 16777216.0f;
}

// Whether a disc of radius m about (x, y) is inside her at rest, row by row.
static bool inside(float x, float y, float m) {
    int top = (int)floorf(y - m), bottom = (int)ceilf(y + m);
    if (top < 0 || bottom >= 466) return false;
    for (int row = top; row <= bottom; row++) {
        float dy = row - y, w = dy * dy < m * m ? sqrtf(m * m - dy * dy) : 0;
        if (x - w < GLASS_OUTLINE[row][0] || x + w > GLASS_OUTLINE[row][1]) return false;
    }
    return true;
}

void glass_start(glass_t *g, uint32_t seed) {
    *g = (glass_t){ .seed = seed ? seed : 1, .next = 0.2f };
    float area = 0, sum[2] = { 0, 0 };
    for (int row = 0; row < 466; row++) {
        float w = GLASS_OUTLINE[row][1] - GLASS_OUTLINE[row][0] + 1;
        if (w <= 0) continue;
        area += w;
        sum[0] += w * (GLASS_OUTLINE[row][0] + GLASS_OUTLINE[row][1]) / 2;
        sum[1] += w * row;
    }
    centre[0] = sum[0] / area;
    centre[1] = sum[1] / area;
}

void glass_poke(glass_t *g, float strength) {
    g->give += POKE * fminf(1, fmaxf(0, strength));
}

// A new bubble, the biggest least often, somewhere in her lower half.
static void spawn(glass_t *g, const float u[2]) {
    glass_bubble_t *b = g->bubbles;
    while (b < g->bubbles + GLASS_BUBBLES && b->state != GLASS_NONE) b++;
    if (b == g->bubbles + GLASS_BUBBLES) return;
    float pick = rnd(g);
    uint8_t size = pick < 0.4f ? 0 : pick < 0.8f ? 1 : 2;
    for (int i = 0; i < TRIES; i++) {
        float x = GLASS_CROP[0] + rnd(g) * GLASS_CROP[2], y = GLASS_CROP[1] + rnd(g) * GLASS_CROP[3];
        if ((x - centre[0]) * u[0] + (y - centre[1]) * u[1] > 0 || !inside(x, y, GLASS_RADIUS[size] + 1)) continue;
        *b = (glass_bubble_t){ .x = x, .y = y, .size = size, .state = GLASS_RISING, .sway = rnd(g) * 2 * (float)M_PI };
        return;
    }
}

void glass_step(glass_t *g, const glass_mood_t *m, float dt) {
    // The wobble, a damped spring about rest.
    float w = 2 * (float)M_PI * BOUNCE_HZ;
    g->give += (-w * w * g->wobble - 2 * DAMPING * w * g->give) * dt;
    g->wobble += g->give * dt;

    // The breath, toward stretched and back. Its depth eases and its phase
    // only ever moves on, so neither holding it nor a new pace jumps a render.
    g->deep += (m->depth - g->deep) * (1 - expf(-DEEPEN * dt));
    g->breath = fmodf(g->breath + dt / m->period, 1);
    float breath = -g->deep * (0.5f - 0.5f * cosf(2 * (float)M_PI * g->breath));
    g->shape = fminf(GLASS_SQUASH[GLASS_FRAMES - 1], fmaxf(GLASS_SQUASH[0], g->wobble + breath));

    // Up, as a direction; held flat it is the screen's own.
    float len = hypotf(m->up[0], m->up[1]), u[2] = { 0, -1 };
    if (len > 0.15f) { u[0] = m->up[0] / len; u[1] = m->up[1] / len; }
    float upright = fminf(1, len), across[2] = { -u[1], u[0] };

    int live = 0;
    for (int i = 0; i < GLASS_BUBBLES; i++) live += g->bubbles[i].state != GLASS_NONE;
    g->next -= dt;
    if (g->next <= 0) {
        if (live < m->most) spawn(g, u);
        g->next = m->every * (0.5f + rnd(g));
    }

    float k = 1 - expf(-FOLLOW * dt);
    for (int i = 0; i < GLASS_BUBBLES; i++) {
        glass_bubble_t *b = &g->bubbles[i];
        if (b->state == GLASS_POPPING) {
            b->shown -= FADE_OUT * dt;
            if (b->shown <= 0) b->state = GLASS_NONE;
        }
        if (b->state != GLASS_RISING) continue;
        b->shown = fminf(1, b->shown + FADE_IN * dt);
        // Rising the way up is, bigger ones faster, swaying across it.
        b->sway += dt * (1.6f + 8 * m->stir);
        float rise = m->rise * (0.25f + 0.75f * upright) * (0.75f + 0.25f * b->size);
        float side = cosf(b->sway) * (SWAY_PX + STIR_PX * m->stir);
        b->vx += (u[0] * rise + across[0] * side - b->vx) * k;
        b->vy += (u[1] * rise + across[1] * side - b->vy) * k;
        // At her edge it keeps rising if it can, and pops where it cannot.
        float r = GLASS_RADIUS[b->size], dx = b->vx * dt, dy = b->vy * dt, along = dx * u[0] + dy * u[1];
        if (inside(b->x + dx, b->y + dy, r)) {
            b->x += dx;
            b->y += dy;
        } else if (along > 0 && inside(b->x + along * u[0], b->y + along * u[1], r)) {
            b->x += along * u[0];
            b->y += along * u[1];
        } else if (along > 0) {
            b->state = GLASS_POPPING;
        }
    }
}

int glass_frame(const glass_t *g) {
    int best = 0;
    for (int f = 1; f < GLASS_FRAMES; f++) {
        if (fabsf(GLASS_SQUASH[f] - g->shape) < fabsf(GLASS_SQUASH[best] - g->shape)) best = f;
    }
    return best;
}

void glass_scale(int frame, float scale[2]) {
    scale[0] = 1 + GLASS_SQUASH[frame];
    scale[1] = 1 / scale[0];
}

void glass_place(int frame, float x, float y, float at[2]) {
    float s[2];
    glass_scale(frame, s);
    at[0] = GLASS_ANCHOR[0] + (x - GLASS_ANCHOR[0]) * s[0];
    at[1] = GLASS_ANCHOR[1] + (y - GLASS_ANCHOR[1]) * s[1];
}

bool glass_chord(float x, float y, float dx, float dy, float margin, float ends[4]) {
    if (!inside(x, y, margin)) return false;
    float len = hypotf(dx, dy);
    for (int side = 0; side < 2; side++) {
        float step = side ? -2 : 2, at[2] = { x, y };
        while (inside(at[0] + dx / len * step, at[1] + dy / len * step, margin)) {
            at[0] += dx / len * step;
            at[1] += dy / len * step;
        }
        ends[2 * side] = at[0];
        ends[2 * side + 1] = at[1];
    }
    return true;
}
