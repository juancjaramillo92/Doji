#include "ogg.h"

#include <string.h>

// What an Opus decoder drops from the start: the encoder's lookahead, in 48 kHz samples.
#define PRE_SKIP 312

// Ogg's CRC: polynomial 0x04C11DB7, no reflection, starting and ending at zero.
static uint32_t crc(const uint8_t *p, size_t n) {
    uint32_t c = 0;
    for (size_t i = 0; i < n; i++) {
        c ^= (uint32_t)p[i] << 24;
        for (int b = 0; b < 8; b++) c = c & 0x80000000u ? c << 1 ^ 0x04C11DB7u : c << 1;
    }
    return c;
}

static void le(uint8_t *p, uint64_t v, int bytes) {
    for (int i = 0; i < bytes; i++) p[i] = (uint8_t)(v >> 8 * i);
}

// One page holding one packet: its lacing values say where the packet ends.
static bool page(ogg_t *o, const uint8_t *packet, size_t n, uint8_t flags) {
    size_t segments = n / 255 + 1, head = 27 + segments;
    if (segments > 255 || o->len + head + n > o->size) return false;
    uint8_t *p = o->out + o->len;
    memcpy(p, "OggS", 4);
    p[4] = 0;
    p[5] = flags;
    le(p + 6, o->granule, 8);
    le(p + 14, o->serial, 4);
    le(p + 18, o->page++, 4);
    le(p + 22, 0, 4);
    p[26] = (uint8_t)segments;
    memset(p + 27, 255, segments - 1);
    p[27 + segments - 1] = (uint8_t)(n % 255);
    memcpy(p + head, packet, n);
    le(p + 22, crc(p, head + n), 4);
    o->last = o->len;
    o->len += head + n;
    return true;
}

void ogg_start(ogg_t *o, uint8_t *out, size_t size, uint32_t serial, uint32_t rate) {
    *o = (ogg_t){ .out = out, .size = size, .serial = serial };
    uint8_t head[19] = "OpusHead";
    head[8] = 1;                    // version
    head[9] = 1;                    // mono
    le(head + 10, PRE_SKIP, 2);
    le(head + 12, rate, 4);
    le(head + 16, 0, 3);            // no gain, one stream
    page(o, head, sizeof head, 0x02);
    static const char vendor[] = "doji charm";
    uint8_t tags[8 + 4 + sizeof vendor - 1 + 4];
    memcpy(tags, "OpusTags", 8);
    le(tags + 8, sizeof vendor - 1, 4);
    memcpy(tags + 12, vendor, sizeof vendor - 1);
    le(tags + 12 + sizeof vendor - 1, 0, 4);
    page(o, tags, sizeof tags, 0);
    o->granule = PRE_SKIP;
}

bool ogg_packet(ogg_t *o, const uint8_t *packet, size_t n, uint32_t ms) {
    o->granule += (uint64_t)ms * 48;
    if (page(o, packet, n, 0)) return true;
    o->granule -= (uint64_t)ms * 48;
    return false;
}

size_t ogg_end(ogg_t *o) {
    uint8_t *p = o->out + o->last;
    p[5] |= 0x04;
    size_t n = 27 + p[26];
    for (int i = 0; i < p[26]; i++) n += p[27 + i];
    le(p + 22, 0, 4);
    le(p + 22, crc(p, n), 4);
    return o->len;
}
