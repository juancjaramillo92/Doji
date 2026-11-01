#pragma once
#include <stdbool.h>

/* In standby, two readings a fifth of a second apart, in g along the motion
   sensor's three axes: whether she was moved between them, and so may be
   being lifted. Pure, as everything here is, so a test compiles it. */
bool lift_stirred(const float before[3], const float now[3]);

/* Whether a lift is him looking: two readings a moment apart, the screen
   tilted up toward him in both and held still between them. A swing on a
   keyring or a bump in a pocket is not. */
bool lift_seen(const float first[3], const float second[3]);

/* Awake, two readings about a second apart: whether he is holding her up to
   look — she stays awake — or she has been put down, lying still at any
   angle, or face down — she sleeps. Anything else, a pocket,
   a bag, a hand at his side, is neither, and the quiet spell decides. */
typedef enum { LIFT_ELSE, LIFT_HELD, LIFT_DOWN } lift_hold_t;
lift_hold_t lift_hold(const float before[3], const float now[3]);
