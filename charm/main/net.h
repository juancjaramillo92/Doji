#pragma once
#include <stdbool.h>

/* Joins her Wi-Fi in the background: the network she was last on first, on
   its own radio channel and access point so no scan is needed, then each
   saved one in order; once joined, sets the clock from the internet. The
   clock is read in New York time from the start. */
void net_start(void);

// Whether she is online, waiting up to `ms` for it. False once every network
// has been tried and none answered.
bool net_wait(int ms);

// Long enough for the last network asked directly and four saved ones in turn.
#define NET_ALL_MS 44000

/* Their doors. Each takes the charm's key, the one the setup saved, in
   x-charm-key; the README's "The charms" says what each answers. */
#define EUGENIA_DOOR "https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia"
#define GLADYS_DOOR  "https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-gladys"
