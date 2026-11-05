#pragma once
#include <stdint.h>

/* Standby: light sleep. The chip stops for up to `ms`, and wakes where it
   stopped, with everything kept — her task, her memory, the screen started
   and the picture on it — at PWR, the BOOT button, a tap, or the time. What
   woke her: */
typedef enum { SLEPT, SLEPT_PRESS, SLEPT_TOUCH } slept_t;
slept_t sleep_light(int64_t ms);

/* The pins as an earlier app's deep sleep left them, let go: the panel's
   reset and select and the touch controller's reset held at a level, and the
   buttons and the touch's interrupt with their sleep circuit. Both outlive a
   restart, and a flash, while the battery keeps the chip powered, and held,
   the screen never starts. First thing at every start. */
void sleep_let_go(void);
