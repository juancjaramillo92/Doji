#pragma once
#include <stddef.h>
#include <stdint.h>

// The speaker and both microphones, through the board's codecs.
void sound_start(void);

// 0 to 100.
void sound_volume(int percent);

// Two soft notes: the board is alive and the speaker works.
void sound_chime(void);

/* Records mono 16 kHz into `out` for up to `max` samples and returns how many
   it took; plays mono 16 kHz back. Both report how loud each moment is, for
   the face. */
size_t sound_record(int16_t *out, size_t max, void (*loudness)(float));
void sound_play(const int16_t *in, size_t samples, void (*loudness)(float));
