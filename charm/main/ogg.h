#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* An Ogg Opus file built in memory, one Opus packet to a page: what her door
   transcribes, the same container a Telegram voice note arrives in. Mono, the
   rate the samples were recorded at named in its head. Pure, so a test
   compiles it on its own. */
typedef struct {
    uint8_t *out;
    size_t size, len;
    uint32_t serial, page;
    uint64_t granule;   // in 48 kHz samples, as Opus counts them
    size_t last;        // where the newest page starts, to mark it the end
} ogg_t;

// Starts the file in `out`, `size` bytes, with its head and tags pages.
void ogg_start(ogg_t *o, uint8_t *out, size_t size, uint32_t serial, uint32_t rate);

// One packet, `ms` milliseconds of sound. False when it no longer fits.
bool ogg_packet(ogg_t *o, const uint8_t *packet, size_t n, uint32_t ms);

// Marks the newest page the last; returns the file's length.
size_t ogg_end(ogg_t *o);
