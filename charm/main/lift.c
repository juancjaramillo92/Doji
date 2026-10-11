#include "lift.h"

#include <math.h>

/* Readings, not facts, until the real board says otherwise: which way the
   sensor's z axis points relative to the screen (+1, out of it), how far up
   the screen must face — the share of gravity along it, 0.4 being about 24
   degrees back from upright — and how still two readings must be. */
#define SCREEN_Z  1
#define FACING    0.4f
#define STILL     0.15f

bool lift_seen(const float first[3], const float second[3]) {
    float moved = 0;
    for (int i = 0; i < 3; i++) moved += fabsf(first[i] - second[i]);
    return SCREEN_Z * first[2] >= FACING && SCREEN_Z * second[2] >= FACING && moved <= STILL;
}
