#pragma once
#include <stdbool.h>

/* The motion sensor. Before sleep, armed to wake her: its interrupt, wired to
   GPIO21, held high until a movement drops it. After a wake it caused, whether
   the movement was him lifting her to look (lift.c). On the shared I2C bus,
   started by power_start. */
void motion_arm(void);
bool motion_looked(void);
