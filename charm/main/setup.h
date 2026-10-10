#pragma once

/* The setup. The charm becomes her own locked Wi-Fi network and shows a QR
   code that joins it; the page that opens asks for her Wi-Fi networks and the
   two keys, each tried before it is saved, and finishing restarts her. Never
   returns. Call with the screen started and unlocked. */
void setup_run(void);
