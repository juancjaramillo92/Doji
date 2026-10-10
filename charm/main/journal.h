#pragma once
#include <stdbool.h>

/* One journal question across the whole screen: 0 the setup (B&R on the left,
   S&R on the right), 1 to 3 rules, stop loss and take profit (no on the left,
   yes on the right). Four dots at the top: answered, this
   one, still to come, from `missing`. Waits for a tap on a half and returns
   it, 0 left and 1 right, after the half has lit; -1 when he walks away. Call
   from her task, with the display unlocked. */
int journal_ask(int q, const bool missing[4]);

// Takes the questions off the screen.
void journal_hide(void);
