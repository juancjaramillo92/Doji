#pragma once
#include <stdbool.h>

/* How long she sleeps before her next errand, in seconds. On the cable,
   often, so the charge stays current; otherwise every few minutes, and
   longer for each errand in a row that found no network (`away`), since
   until one answers there is nothing to ask — never so long that an hour
   passes without one, so the night's look for an update always has an
   errand. A lift or a press tries the network whenever it comes. Pure, so a
   test compiles it on its own. */
int errand_wait(bool charging, int away);
