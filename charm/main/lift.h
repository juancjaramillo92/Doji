#pragma once
#include <stdbool.h>

/* Whether a lift is him looking: two readings of the motion sensor a moment
   apart, in g along its three axes, the screen tilted up toward him in both
   and held still between them. A swing on a keyring or a bump in a pocket is
   not. Pure, so a test compiles it on its own. */
bool lift_seen(const float first[3], const float second[3]);
