#pragma once
#include <stdbool.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/* The power chip, and the two buttons, watched from their own task. PWR is
   the talk button: each press is a notification to `talker`, except the
   press that woke her, at power-on or from standby, which main.c answers
   itself. Held three seconds — a
   ring empties round the rim as it is — she says goodnight and the board
   switches off; off, a press switches it on, the chip's own doing. BOOT held
   for five seconds opens the setup. */
void power_start(TaskHandle_t talker);

// PWR reaches the chip on GPIO3, high while pressed; BOOT pulls GPIO0 low.
#define PWR_PIN  3
#define BOOT_PIN 0

// PWR woke her from standby: that press is main.c's, its release no tap.
void power_woke(void);

// The board switched off through the power chip; PWR switches it on again.
void power_off(void);

// Whether the battery is low and no cable is charging it.
bool power_low(void);

// On the cable, the battery's percent; -1 off it.
int power_charge(void);

// The battery's percent, on the cable or off it; -1 with none connected.
int power_battery(void);
