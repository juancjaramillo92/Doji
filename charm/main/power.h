#pragma once
#include <stdbool.h>

/* The power chip. The PWR button is its own: a press switches the board on,
   and held while she is awake it now says goodnight — her eyes close — and
   switches the board off. Watched from its own task. After the screen has
   started, which brings up the bus the chip is on. */
void power_start(void);

// Whether the battery is low and nothing is charging it.
bool power_low(void);
