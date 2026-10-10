#pragma once
#include <time.h>

/* Deep sleep. The chip stops, and wakes as if from reset — app_main runs
   again — on a tap, the BOOT button, or at `wake_at` (0 for never). What is
   on the screen stays: the panel keeps its own picture while it has power, and
   the pins that could reset it are held. Only RTC_DATA_ATTR memory survives. */
void sleep_until(time_t wake_at);

// Lets go of the held pins, before the screen starts.
void sleep_release(void);
