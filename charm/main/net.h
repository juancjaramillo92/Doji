#pragma once
#include <stdbool.h>

/* Joins the first of her saved networks that answers, then sets the clock to
   New York time from the internet. False when none of them could be joined. */
bool net_start(void);

/* Where she is answered. It takes the charm's key, the one the setup page
   saved, in x-charm-key; the README's "The charms" says what it answers. */
#define EUGENIA_DOOR "https://gujhyogvkzjgnrodyuse.supabase.co/functions/v1/doji-eugenia"
