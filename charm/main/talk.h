#pragma once

/* One exchange with Eugenia: he talks, she answers. Call from the audio task
   after a tap; a tap while it runs — a notification to that task — ends his
   turn early, or cuts her off. */
void talk(void);
