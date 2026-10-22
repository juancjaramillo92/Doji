#pragma once
#include <stdbool.h>
#include <time.h>

/* How long she sleeps before her next errand, in seconds. On the cable,
   often, so the charge stays current; otherwise every few minutes, and
   longer for each errand in a row that found no network (`away`), since
   until one answers there is nothing to ask. Over the weekend, from an hour
   after the Friday close to the Sunday open, nothing new can come in for
   Gladys, so unless a `trade` already waits — whose ring a journal in
   Telegram may clear — she asks as seldom as she ever does, and wakes for
   the open. Never so long that an hour passes without an errand, so the
   night's look for an update always has one; a lift or a press tries the
   network whenever it comes. Pure, so a test compiles it on its own. */
int errand_wait(time_t now, bool charging, bool trade, int away);
