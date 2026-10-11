/* Sound through the board's two codecs: the ES8311 drives the speaker, the
   ES7210 reads the two microphones. They share one I2S bus, so they always run
   at one sample rate and both are reopened together when it changes. Two
   channels on the wire: the microphones arrive as a pair, and mono out is the
   same sample on both sides. */
#include "sound.h"

#include <math.h>
#include "bsp/esp-bsp.h"
#include "esp_codec_dev.h"

#define CHUNK 512  // frames per read or write

static esp_codec_dev_handle_t speaker, mics;
static int16_t wire[CHUNK * 2];
static uint32_t rate_now;

// Reopened only when the rate changes, so a reply played in pieces as it
// arrives runs on as one sound.
static void open_at(uint32_t rate) {
    if (rate == rate_now) return;
    rate_now = rate;
    esp_codec_dev_close(speaker);
    esp_codec_dev_close(mics);
    esp_codec_dev_sample_info_t fs = { .sample_rate = rate, .channel = 2, .bits_per_sample = 16 };
    esp_codec_dev_open(speaker, &fs);
    esp_codec_dev_open(mics, &fs);
    esp_codec_dev_set_in_gain(mics, 24.0f);
}

void sound_start(void) {
    speaker = bsp_audio_codec_speaker_init();
    mics = bsp_audio_codec_microphone_init();
    open_at(16000);
}

void sound_volume(int percent) {
    esp_codec_dev_set_out_vol(speaker, percent);
}

// Root mean square of a run of samples, scaled so ordinary speech fills 0 to 1.
static float loudness_of(const int16_t *s, size_t n, size_t step) {
    double sum = 0;
    for (size_t i = 0; i < n; i++) sum += (double)s[i * step] * s[i * step];
    float rms = sqrtf((float)(sum / n)) / 32768.0f;
    float l = rms * 6.0f;
    return l > 1 ? 1 : l;
}

/* Two notes one after the other, each its pitch in Hz and its length in
   seconds, rising in at `attack` and dying away at `decay`, both per second. */
static void play_notes(const float notes[2][2], float attack, float decay, float loud) {
    open_at(16000);
    for (int n = 0; n < 2; n++) {
        size_t frames = (size_t)(16000 * notes[n][1]);
        for (size_t at = 0; at < frames; at += CHUNK) {
            size_t k = frames - at < CHUNK ? frames - at : CHUNK;
            for (size_t i = 0; i < k; i++) {
                float t = (float)(at + i) / 16000.0f;
                float env = fminf(1.0f, t * attack) * expf(-t * decay);
                wire[2 * i] = wire[2 * i + 1] = (int16_t)(sinf(2 * (float)M_PI * notes[n][0] * t) * env * loud);
            }
            esp_codec_dev_write(speaker, wire, (int)(k * 4));
        }
    }
}

void sound_chime(void) {
    static const float notes[2][2] = { { 659.25f, 0.12f }, { 880.0f, 0.24f } };
    play_notes(notes, 200.0f, 9.0f, 9000);
}

void sound_tick(void) {
    open_at(16000);
    for (int n = 0; n < 2; n++) {
        // A tick: 8 ms of a high note dying fast, then the quiet between the two.
        for (size_t at = 0; at < 1760; at += CHUNK) {
            size_t k = 1760 - at < CHUNK ? 1760 - at : CHUNK;
            for (size_t i = 0; i < k; i++) {
                float t = (float)(at + i) / 16000.0f;
                float env = t < 0.008f ? expf(-t * 600.0f) : 0;
                wire[2 * i] = wire[2 * i + 1] = (int16_t)(sinf(2 * (float)M_PI * 1800.0f * t) * env * 7000);
            }
            esp_codec_dev_write(speaker, wire, (int)(k * 4));
        }
    }
}

void sound_listen(void) {
    static const float notes[2][2] = { { 660.0f, 0.07f }, { 990.0f, 0.11f } };
    play_notes(notes, 400.0f, 22.0f, 6000);
}

void sound_sent(void) {
    static const float notes[2][2] = { { 990.0f, 0.07f }, { 660.0f, 0.11f } };
    play_notes(notes, 400.0f, 22.0f, 6000);
}

size_t sound_record(int16_t *out, size_t max, bool (*more)(float)) {
    open_at(16000);
    size_t got = 0;
    while (got < max) {
        size_t k = max - got < CHUNK ? max - got : CHUNK;
        if (esp_codec_dev_read(mics, wire, (int)(k * 4)) != ESP_CODEC_DEV_OK) break;
        for (size_t i = 0; i < k; i++) out[got + i] = wire[2 * i];
        got += k;
        if (!more(loudness_of(wire, k, 2))) break;
    }
    return got;
}

bool sound_play(const int16_t *in, size_t samples, uint32_t rate, bool (*more)(float)) {
    open_at(rate);
    for (size_t at = 0; at < samples; at += CHUNK) {
        size_t k = samples - at < CHUNK ? samples - at : CHUNK;
        if (!more(loudness_of(in + at, k, 1))) return false;
        for (size_t i = 0; i < k; i++) wire[2 * i] = wire[2 * i + 1] = in[at + i];
        esp_codec_dev_write(speaker, wire, (int)(k * 4));
    }
    return true;
}
