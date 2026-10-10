#pragma once
#include <stdbool.h>

/* One exchange with Eugenia: he talks, she answers. Call from her task after
   a tap; a tap while it runs — a notification to that task — ends his turn
   early, or cuts her off. The same holds for the two below. True when she
   answered: an exchange that reached her door. */
bool talk(void);

/* Asks whether today's briefing has landed. When it has, `lit` lights the
   screen for her and she says so, and this is true; false while it has not,
   or when her door could not be reached, and the screen is left alone. */
bool talk_ready(void (*lit)(void));

// Today's briefing, read to him, and true when it was. Nothing happens while
// none is stored.
bool talk_briefing(void);
