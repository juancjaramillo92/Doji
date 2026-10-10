#pragma once
#include <stdbool.h>

/* Reads the clock in New York time, joins the first of her saved networks
   that answers, and sets the clock from the internet. False when none of them
   could be joined. */
bool net_start(void);

/* Where she is answered. It takes the charm's key, the one the setup page
   saved, in x-charm-key; the README's "The charms" says what it answers. */
#define EUGENIA_DOOR "https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia"
