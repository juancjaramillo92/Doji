#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// The speaker and both microphones, through the board's codecs.
void sound_start(void);

// 0 to 100.
void sound_volume(int percent);

// Two soft notes: the board is alive and the speaker works.
void sound_chime(void);

// Gladys's soft double tick: a trade waits for its journal.
void sound_tick(void);

/* Both hand `more` how loud each moment is, 0 to 1, and stop when it answers
   false. Recording is mono 16 kHz into `out`, up to `max` samples, and returns
   how many it took. Playing is mono at `rate` and returns false when `more`
   stopped it. */
size_t sound_record(int16_t *out, size_t max, bool (*more)(float));
bool sound_play(const int16_t *in, size_t samples, uint32_t rate, bool (*more)(float));
