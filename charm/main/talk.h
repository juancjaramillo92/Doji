#pragma once
#include <stdbool.h>

/* One exchange with Eugenia: he talks, she answers. Call from her task after
   a tap; a tap while it runs — a notification to that task — ends his turn
   early, or cuts her off. The same holds for the two below. */
void talk(void);

/* Asks whether today's briefing has landed. When it has, her face lights and
   she says so, and this is true; false while it has not, or when her door
   could not be reached. The screen stays as it was until then. */
bool talk_ready(void);

// Today's briefing, read to him. Nothing happens while none is stored.
void talk_briefing(void);
