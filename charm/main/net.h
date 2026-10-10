#pragma once
#include <stdbool.h>

/* Joins the first of her saved networks that answers, then sets the clock to
   New York time from the internet. False when none of them could be joined. */
bool net_start(void);
