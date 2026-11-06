#include "lift.h"

#include <math.h>

/* Readings, not facts, until the real board says otherwise: which way the
   sensor's z axis points relative to the screen (+1, out of it), how far up
   the screen must face — the share of gravity along it, 0.4 being about 24
   degrees back from upright — and how still two readings must be. */
#define SCREEN_Z  1
#define FACING    0.4f
#define STILL     0.15f

/* A reading too: how little two readings may differ for her to be lying
   somewhere rather than in a hand, which never holds that still. Stillness
   alone, at any angle: on a table she sits propped on her keyring and her
   case, tilted further than any test of flatness could allow for. */
#define RESTING   0.01f

static float moved(const float a[3], const float b[3]) {
    float m = 0;
    for (int i = 0; i < 3; i++) m += fabsf(a[i] - b[i]);
    return m;
}

bool lift_seen(const float first[3], const float second[3]) {
    return SCREEN_Z * first[2] >= FACING && SCREEN_Z * second[2] >= FACING && moved(first, second) <= STILL;
}

bool lift_moved(const float rest[3], const float now[3]) {
    return moved(rest, now) > STILL;
}

lift_hold_t lift_hold(const float before[3], const float now[3]) {
    float z = SCREEN_Z * now[2];
    bool lying = moved(before, now) <= RESTING;
    if (lying || z <= -FACING) return LIFT_DOWN;
    return z >= FACING ? LIFT_HELD : LIFT_ELSE;
}
