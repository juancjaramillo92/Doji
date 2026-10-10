#pragma once

/* The setup page. The charm becomes its own open Wi-Fi network,
   "Charm-Setup-XXXX"; a phone that joins it is sent to the page, which asks
   who she is, her Wi-Fi networks and her key. Saving restarts her. Never
   returns. Call with the display unlocked. */
void setup_run(void);
