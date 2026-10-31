#pragma once
#include <stdbool.h>
#include <time.h>

/* Updates over Wi-Fi. Whether tonight's look for one is due: once a night,
   in the small hours, never before the internet has set the clock. Asking
   spends it: a yes marks the night looked. */
bool ota_due(time_t now);

/* Looks at the newest app from main and, when its version is not hers,
   writes it into her other app slot to start from next; true when it did.
   Reading the version costs only the image's first bytes. */
bool ota_update(void);

/* Whether an app of this version is worth fetching: not hers, and not one
   that was here and failed to prove itself, which would be fetched, fail and
   roll back again at every errand. Asks nothing of the network. */
bool ota_offered(const char *version);

/* A new app not yet proved: any reset before ota_confirm, deep sleep included,
   has the bootloader start the app that was. */
bool ota_unproven(void);

// The app she runs is good, and stays.
void ota_confirm(void);
