#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

// The speaker and both microphones, through the board's codecs. Set the
// volume after.
void sound_start(void);

// The rate the microphones record at, and the notes play at.
#define SOUND_RATE 16000

/* Both codecs closed, the speaker's amplifier with them: they are powered
   by the board, not the chip, so deep sleep alone leaves them biased. Before
   every sleep; nothing to do when sound never started. */
void sound_stop(void);

// 0 to 100.
void sound_volume(int percent);

// Two soft notes: the board is alive and the speaker works.
void sound_chime(void);

// Gladys's soft double tick: a trade waits for its journal. While he talks,
// half a minute of his turn is left.
void sound_tick(void);

// Two quick notes, rising: she heard PWR and is listening.
void sound_listen(void);

// The same two, falling: his words are on their way to her.
void sound_sent(void);

/* Both hand `more` how loud each moment is, 0 to 1, and stop when it answers
   false. Recording is mono at SOUND_RATE, handed to `more` a run of samples
   at a time. Playing is mono at `rate` and returns false when `more` stopped
   it. */
void sound_record(bool (*more)(const int16_t *in, size_t n, float loud));
bool sound_play(const int16_t *in, size_t samples, uint32_t rate, bool (*more)(float));
