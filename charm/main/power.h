#pragma once
#include <stdbool.h>

/* The power chip. The PWR button is its own: a press switches the board on,
   and held while she is awake it now says goodnight — her eyes close — and
   switches the board off. Watched from its own task. */
void power_start(void);

// Whether the battery is low and no cable is charging it.
bool power_low(void);

// On the cable, the battery's percent; -1 off it.
int power_charge(void);
