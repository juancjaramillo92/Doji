#pragma once
#include <time.h>

/* When Eugenia's charm next wakes to ask whether today's briefing has landed:
   from a few minutes past its hour, every ten minutes, until she has announced
   it or its retries are over — and then the next day that has one. Before the
   internet has set the clock, in half an hour. */
time_t briefing_next_ask(time_t now);

// She announced today's: no more asking until the next briefing.
void briefing_announced(time_t now);
