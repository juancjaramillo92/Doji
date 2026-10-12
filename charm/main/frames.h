#pragma once
#include <stddef.h>
#include <stdint.h>

/* Her door's answer, in frames: a kind byte, three bytes of length, big-endian,
   then that many bytes. Her voice is raw pcm, 24 kHz, 16-bit little-endian,
   mono; a volume is one byte, 0 to 100, sent before her voice so it already
   sounds that way. The kinds are a copy of `FRAME` in doji-eugenia, and
   test/charm.test.mjs feeds this the bytes `charmFrame` makes there. Pure, so
   a test compiles it on its own. */
#define FRAME_VOICE  0
#define FRAME_VOLUME 1

typedef struct {
    uint8_t head[4];
    uint32_t got;    // bytes of the current header read
    uint32_t left;   // bytes of the current frame still to come
    uint8_t half;    // a voice byte waiting for the rest of its sample
    uint8_t odd;
} frames_t;

/* Reads `n` bytes of the answer, however the reads fall across frames, and
   puts her voice in `out` as whole samples, returning how many: room for
   n / 2 + 1. A volume frame sets `*volume`, which is left alone otherwise; a
   kind it does not know is skipped. */
size_t frames_read(frames_t *f, const uint8_t *in, size_t n, int16_t *out, int *volume);
