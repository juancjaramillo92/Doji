#pragma once
#include <stdbool.h>
#include <time.h>

/* Deep sleep. The chip stops, and wakes as if from reset — app_main runs
   again — at PWR, the BOOT button, a tap, a lift when `motion` (the motion
   sensor armed first), or at `wake_at`. What is on the screen stays: the
   panel keeps its own picture while it has power, and the pins that could
   reset it are held. Only RTC_DATA_ATTR memory survives. */
void sleep_until(time_t wake_at, bool motion);

// Lets go of the held pins, before the screen starts.
void sleep_release(void);

// The motion sensor's interrupt, for telling what woke her.
#define MOTION_PIN 21
