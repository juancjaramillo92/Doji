#include "frames.h"

size_t frames_read(frames_t *f, const uint8_t *in, size_t n, int16_t *out, int *volume) {
    size_t got = 0;
    for (size_t i = 0; i < n; i++) {
        uint8_t b = in[i];
        if (!f->left) {
            f->head[f->got++] = b;
            if (f->got == 4) {
                f->got = 0;
                f->left = (uint32_t)f->head[1] << 16 | (uint32_t)f->head[2] << 8 | f->head[3];
            }
            continue;
        }
        f->left--;
        if (f->head[0] == FRAME_VOLUME) *volume = b > 100 ? 100 : b;
        if (f->head[0] != FRAME_VOICE) continue;
        if (f->odd) out[got++] = (int16_t)(f->half | b << 8);
        else f->half = b;
        f->odd ^= 1;
    }
    return got;
}
