#pragma once
#include <stdbool.h>

/* What the face is doing. Set from any task: the animation timer reads it on
   the next frame, so a mode change is an expression change, never a jump. */
typedef enum {
    FACE_IDLE,       // awake: blinks, glances
    FACE_LISTENING,  // he is talking: eyes up, the ring follows his voice
    FACE_SPEAKING,   // she is talking: the mouth follows her voice
    FACE_THINKING,   // her answer is on its way: up and away, the thought dots
    FACE_CONFUSED,   // something went wrong: a door refused, no network
    FACE_ASLEEP,     // going to sleep: the eyes close slowly
    FACE_DARK,       // the screen black: she is asking something quietly
    FACE_DOT,        // black but for her still dot: something waits for him
} face_mode_t;

/* Builds the screen for one of the two characters. Under the display lock.
   Set FACE_DARK or FACE_DOT first and her face never shows; leaving either,
   her eyes open as they do at boot. */
void face_start(bool gladys);

void face_set_mode(face_mode_t mode);

// How loud the audio is right now, 0 to 1: the ring while listening, the
// mouth while speaking.
void face_set_level(float level);
