#pragma once
#include <stdbool.h>
#include "lvgl.h"

/* The volume dial: a finger sliding round the rim, one full turn from silent
   to loudest. Fed from the screen's touch events, in LVGL's own task: a press
   on the rim takes hold, a slide turns it, and lifting saves the volume. */
void dial_press(lv_point_t at);
void dial_slide(lv_point_t at);
void dial_lift(void);

// Whether the press just lifted turned the dial, so it was not a tap.
bool dial_turned(void);
