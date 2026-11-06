#pragma once
#include <stdbool.h>
#include <stdint.h>

/* One exchange with Eugenia: he talks, she answers. Call from her task after
   PWR; PWR while it runs — a notification to that task — ends his turn, or
   cuts her off. The same holds for the two below. Returns what her
   door answered — 200 when she did — 0 when he said nothing, and -1 when
   her door could not be reached or her answer was cut off, which a network
   already given up answers before he is recorded. With the network gone,
   that is left to the sleep screen to show; with it up, a -1 shows her
   confused, as does any answer but 200, an encoder that will not start or
   no room to record in, which is 0. */
int talk(void);

/* Asks whether today's briefing has landed. When it has, `lit` lights the
   screen for her and she says so, and this is true; false while it has not,
   or when her door could not be reached, and the screen is left alone. */
bool talk_ready(void (*lit)(void));

// Today's briefing, read to him: what her door answered, 204 while none is
// stored, -1 out of reach or cut off.
int talk_briefing(void);

// When she first listened this waking, in microseconds since boot; 0 if not.
int64_t talk_listened(void);

/* One line about the waking for her door to file, `text` as it is: never
   retried, never held for, and a few seconds at most. */
void talk_report(const char *text);
