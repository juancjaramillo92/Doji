#pragma once
#include <stdbool.h>
#include "lift.h"

/* The motion sensor. Before sleep, armed to wake her: its interrupt, wired to
   GPIO21, held high until a movement drops it. After a wake it caused, whether
   the movement was him lifting her to look (lift.c). On the shared I2C bus,
   started by power_start. */
void motion_arm(void);
bool motion_looked(void);

/* Awake, about once a second: held up to look, put down, or neither, judged
   by lift.c against the reading before. The first call has nothing to judge
   against and answers neither. */
lift_hold_t motion_hold(void);
