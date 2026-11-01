#pragma once
#include <stdbool.h>
#include "lift.h"

/* The motion sensor, read awake and in standby alike, on the shared I2C bus
   started by power_start; what a reading means is lift.c's. */

/* In standby, at each of her checks: whether she has moved since the last
   one. A reading too old to compare, the first after a rest, answers no. */
bool motion_stirred(void);

// Moved: whether it was him lifting her to look, watched as it settles.
bool motion_looked(void);

/* Awake, about once a second: held up to look, put down, or neither, judged
   by lift.c against the reading before. A first call, or one too long after
   the last, has nothing to judge against and answers neither. */
lift_hold_t motion_hold(void);
