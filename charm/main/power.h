#pragma once
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* The power chip, and the two buttons, watched from their own task. PWR is
   the talk button: each press is a notification to `talker`, except the
   press that woke her, which main.c answers itself. Held three seconds — a
   ring empties round the rim as it is — she says goodnight and the board
   switches off; off, a press switches it on, the chip's own doing. BOOT held
   for five seconds opens the setup. */
void power_start(TaskHandle_t talker);

// PWR reaches the chip on GPIO3, high while pressed; BOOT pulls GPIO0 low.
#define PWR_PIN  3
#define BOOT_PIN 0

// Whether the battery is low and no cable is charging it.
bool power_low(void);

// On the cable, the battery's percent; -1 off it.
int power_charge(void);
