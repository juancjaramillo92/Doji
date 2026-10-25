#pragma once
#include <stdbool.h>

/* Whether a lift is him looking: two readings of the motion sensor a moment
   apart, in g along its three axes, the screen tilted up toward him in both
   and held still between them. A swing on a keyring or a bump in a pocket is
   not. Pure, so a test compiles it on its own. */
bool lift_seen(const float first[3], const float second[3]);

/* Awake, two readings about a second apart: whether he is holding her up to
   look — she stays awake — or she has been put down, lying flat and still on
   a table either way up, or face down — she sleeps. Anything else, a pocket,
   a bag, a hand at his side, is neither, and the quiet spell decides. */
typedef enum { LIFT_ELSE, LIFT_HELD, LIFT_DOWN } lift_hold_t;
lift_hold_t lift_hold(const float before[3], const float now[3]);

/* Awake and showing her face, a reading many times a second: which way is up
   across the screen, x right and y down, its length how upright she is held,
   0 lying flat to 1 upright; and, against the reading before, how hard a
   jolt it was, 0 for a hand's ordinary movement to 1. */
void lift_up(const float g[3], float up[2]);
float lift_jolt(const float before[3], const float now[3]);
