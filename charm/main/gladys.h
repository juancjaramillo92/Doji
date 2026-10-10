#pragma once

// How many trades wait for their journal; -1 when her door could not be reached.
int gladys_check(void);

/* A press: journals what waits, oldest first, one question at a time, each
   answer sent as he gives it; done, she is pleased, and delighted when every
   answer was a yes. Walking away leaves the rest for the next time. Returns
   how many still wait, or -1 when her door could not be reached, which her
   face shows. Call from her task. */
int gladys_journal(void);
