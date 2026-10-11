#pragma once
#include <stdbool.h>

/* The power chip, and the two buttons. PWR is the chip's own: a press
   switches the board on, and held a second and a half — awake, or woken by
   that very press — she says goodnight, her eyes close, and the board switches
   off. BOOT held for five seconds opens the setup. Both watched from their own
   task. */
void power_start(void);

// PWR reaches the chip on GPIO3, high while pressed; BOOT pulls GPIO0 low.
#define PWR_PIN  3
#define BOOT_PIN 0

// Whether the battery is low and no cable is charging it.
bool power_low(void);

// On the cable, the battery's percent; -1 off it.
int power_charge(void);
