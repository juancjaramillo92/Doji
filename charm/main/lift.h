#pragma once
#include <stdbool.h>

/* Whether a lift is him looking: two readings of the motion sensor a moment
   apart, in g along its three axes, the screen tilted up toward him in both
   and held still between them. A swing on a keyring or a bump in a pocket is
   not. Pure, so a test compiles it on its own. */
bool lift_seen(const float first[3], const float second[3]);

/* Awake, two readings about a second apart: whether he is holding her up to
   look — she stays awake — or she has been put down, lying still at any
   angle, or face down — she sleeps. Anything else, a pocket,
   a bag, a hand at his side, is neither, and the quiet spell decides. */
typedef enum { LIFT_ELSE, LIFT_HELD, LIFT_DOWN } lift_hold_t;
lift_hold_t lift_hold(const float before[3], const float now[3]);
