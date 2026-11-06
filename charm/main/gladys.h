#pragma once

// How many trades wait for their journal; -1 when her door could not be reached.
int gladys_check(void);

/* Journals what waits, oldest first, one question at a time, each answer sent
   as he gives it, on the journal's own screens: done, its tick and ring. An
   answer her door does not take, the network still up, is asked again.
   Whatever happens — done, walked away, PWR, nothing waiting after all, the
   network gone — a journal that showed ends on the dark, never on a face.
   Returns how many still wait, or -1 when her door could not be reached.
   Call from her task. */
int gladys_journal(void);
