#include "lift.h"

#include <math.h>

/* Readings, not facts, until the real board says otherwise: which way the
   sensor's z axis points relative to the screen (+1, out of it), how far up
   the screen must face — the share of gravity along it, 0.4 being about 24
   degrees back from upright — and how still two readings must be. */
#define SCREEN_Z  1
#define FACING    0.4f
#define STILL     0.15f

/* Readings too: how flat is lying on a table — the share of gravity through
   the screen — and how little two readings may differ for her to be lying
   there rather than in a hand, which never holds that still. */
#define FLAT      0.97f
#define RESTING   0.01f

/* Readings too: which way the sensor's x and y axes point across the screen
   (+1, toward its right and its top), and how far two readings a moment
   apart must part to be a jolt rather than a hand, and to be a full one. */
#define SCREEN_X  1
#define SCREEN_Y  1
#define JOLT_FROM 0.5f
#define JOLT_FULL 1.5f

static float moved(const float a[3], const float b[3]) {
    float m = 0;
    for (int i = 0; i < 3; i++) m += fabsf(a[i] - b[i]);
    return m;
}

bool lift_seen(const float first[3], const float second[3]) {
    return SCREEN_Z * first[2] >= FACING && SCREEN_Z * second[2] >= FACING && moved(first, second) <= STILL;
}

lift_hold_t lift_hold(const float before[3], const float now[3]) {
    float z = SCREEN_Z * now[2];
    bool lying = fabsf(z) >= FLAT && moved(before, now) <= RESTING;
    if (lying || z <= -FACING) return LIFT_DOWN;
    return z >= FACING ? LIFT_HELD : LIFT_ELSE;
}

void lift_up(const float g[3], float up[2]) {
    // The sensor reads the push that holds her up, so it points up. Across
    // the screen that is toward its right and its top, and the screen's y
    // runs down.
    up[0] = SCREEN_X * g[0];
    up[1] = -SCREEN_Y * g[1];
    float len = hypotf(up[0], up[1]);
    if (len > 1) { up[0] /= len; up[1] /= len; }
}

float lift_jolt(const float before[3], const float now[3]) {
    return fminf(1, fmaxf(0, (moved(before, now) - JOLT_FROM) / (JOLT_FULL - JOLT_FROM)));
}
