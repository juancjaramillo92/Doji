#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "lvgl.h"

/* What the face is doing. Set from any task: the animation timer reads it on
   the next frame, so a mode change is an expression change, never a jump. */
typedef enum {
    FACE_IDLE,       // awake: blinks, glances
    FACE_LISTENING,  // he is talking: eyes up, the ring follows his voice
    FACE_SPEAKING,   // she is talking: the mouth follows her voice
    FACE_THINKING,   // her answer is on its way: up and away, the thought dots
    FACE_CONFUSED,   // something went wrong: her door refused
    FACE_ASLEEP,     // going to sleep: the eyes close slowly
    FACE_DARK,       // the sleep screen: black but for its marks
} face_mode_t;

/* Builds the screen. Under the display lock. Set FACE_DARK first and no face
   shows; leaving it, her eyes open as at boot. */
void face_start(void);

void face_set_mode(face_mode_t mode);
face_mode_t face_get_mode(void);

// How long FACE_ASLEEP takes to close her eyes.
#define FACE_GOODNIGHT_MS 1200

// How loud the audio is right now, 0 to 1: the ring while listening, the
// mouth while speaking.
void face_set_level(float level);

// PWR held toward switching off, 0 to 1: a ring empties round the rim.
void face_set_hold(float hold);

/* What the sleep screen shows. Low on it, one mark for what waits: a purple
   dot while a briefing does, a white ring while a trade does, the dot inside
   the ring for both. At the top, a small battery when it is `low` and nothing
   charges it, and the no-internet mark when `offline`. While the cable
   charges her, the battery as a ring round the rim with its percent; charge
   is -1 otherwise. */
void face_set_marks(bool briefing, bool trade, bool low, bool offline, int charge);

/* Doji's purples round the rim, from the top for `part` of a turn, `turn`
   spinning the colours: her listening ring, the charge, the journal's done. */
void face_ring(lv_layer_t *layer, int32_t radius, int32_t width, float part, float turn, float opa);
