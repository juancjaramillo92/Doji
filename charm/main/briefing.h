#pragma once
#include <stdbool.h>
#include <time.h>

/* Whether to ask Eugenia's door if today's briefing has landed: from a few
   minutes past its hour until its retries are over, and not once she has
   announced it. Never before the internet has set the clock. */
bool briefing_due(time_t now);

// She announced today's: no more asking until the next briefing.
void briefing_announced(time_t now);

/* Whether the briefing she announced is today's. Her door reads today's alone,
   so a dot left from yesterday's would promise one it no longer serves. */
bool briefing_today(time_t now);
