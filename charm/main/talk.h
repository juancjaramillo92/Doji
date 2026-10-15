#pragma once
#include <stdbool.h>

/* One exchange with Eugenia: he talks, she answers. Call from her task after
   PWR; PWR while it runs — a notification to that task — ends his turn, or
   cuts her off. The same holds for the two below. Returns what her
   door answered — 200 when she did — 0 when he said nothing, and -1 when the
   network could not reach her, which is left to the lock screen to show;
   any other answer shows her confused, as does an encoder that will not
   start or no room to record in, which is 0. */
int talk(void);

/* Asks whether today's briefing has landed. When it has, `lit` lights the
   screen for her and she says so, and this is true; false while it has not,
   or when her door could not be reached, and the screen is left alone. */
bool talk_ready(void (*lit)(void));

// Today's briefing, read to him: what her door answered, 204 while none is
// stored, -1 out of reach.
int talk_briefing(void);
