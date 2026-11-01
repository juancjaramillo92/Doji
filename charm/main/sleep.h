#pragma once
#include <stdint.h>

/* Standby: light sleep. The chip stops for up to `ms`, and wakes where it
   stopped, with everything kept — her task, her memory, the screen started
   and the picture on it — at PWR, the BOOT button, a tap, or the time. What
   woke her: */
typedef enum { SLEPT, SLEPT_PRESS, SLEPT_TOUCH } slept_t;
slept_t sleep_light(int64_t ms);
