/* Eugenia's door, each exchange one request. He talks until he stops — a
   second of quiet after his voice, a tap, or a minute — and the recording goes
   to her door as WAV; the briefing is a GET. What comes back is her raw voice,
   24 kHz mono, played as it arrives: silence while she thinks, which her face
   shows as thinking, then her voice with her mouth following it. */
#include "talk.h"

#include <string.h>
#include "config.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "face.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "net.h"
#include "sound.h"

static const char *TAG = "talk";

#define RATE        16000
#define MAX_SAMPLES (RATE * 60)  // a minute: under her door's 3 MB
#define WAV_HEADER  44
#define HER_RATE    24000

// Readings, not facts: what counts as his voice, how long a pause ends his
// turn, and how long she waits for him to start.
#define VOICE    0.12f
#define QUIET_MS 1200
#define WAIT_MS  6000

// Her door sends a beat of silence every 15 s while she thinks; twice that
// with nothing is a dead line.
#define READ_MS 30000
#define CONFUSED_MS 4000

static TickType_t began, voice_at;
static bool spoke, speaking;

// A tap is a notification to this task: it ends his turn or cuts her off.
static bool tapped(void) { return ulTaskNotifyTake(pdTRUE, 0); }

static bool heard(float loud) {
    face_set_level(loud);
    if (tapped()) return false;
    TickType_t now = xTaskGetTickCount();
    if (loud > VOICE) { spoke = true; voice_at = now; }
    return spoke ? now - voice_at < pdMS_TO_TICKS(QUIET_MS) : now - began < pdMS_TO_TICKS(WAIT_MS);
}

// Her silence is exact zeros, so the first sound above nothing is her voice.
static bool said(float loud) {
    if (tapped()) return false;
    if (loud > 0 && !speaking) { speaking = true; face_set_mode(FACE_SPEAKING); }
    face_set_level(loud);
    return true;
}

static void wav_header(uint8_t *h, size_t samples) {
    uint32_t data = (uint32_t)(samples * 2), riff = data + 36, fmt = 16, rate = RATE, bytes = RATE * 2;
    uint16_t pcm = 1, mono = 1, block = 2, bits = 16;
    memcpy(h, "RIFF", 4);       memcpy(h + 4, &riff, 4);   memcpy(h + 8, "WAVEfmt ", 8);
    memcpy(h + 16, &fmt, 4);    memcpy(h + 20, &pcm, 2);   memcpy(h + 22, &mono, 2);
    memcpy(h + 24, &rate, 4);   memcpy(h + 28, &bytes, 4); memcpy(h + 32, &block, 2);
    memcpy(h + 34, &bits, 2);   memcpy(h + 36, "data", 4); memcpy(h + 40, &data, 4);
}

// Plays her answer as it streams in. An odd byte is half a sample, and waits
// at the front for the rest.
static void play_answer(esp_http_client_handle_t h) {
    static int16_t buf[2048];
    uint8_t *bytes = (uint8_t *)buf;
    size_t have = 0;
    speaking = false;
    for (;;) {
        face_set_level(0);
        int n = esp_http_client_read(h, (char *)bytes + have, (int)(sizeof buf - have));
        if (n <= 0) return;
        have += (size_t)n;
        if (!sound_play(buf, have / 2, HER_RATE, said)) return;
        if (have & 1) bytes[0] = bytes[have - 1];
        have &= 1;
    }
}

/* Knocks at her door — a POST of `wav` when there is one, else a GET of
   `url` — and plays the answer when it is 200, lighting her face for it
   first. Returns the status, or -1 when the door could not be reached. */
static int knock(const char *url, const uint8_t *wav, size_t len) {
    esp_http_client_config_t c = {
        .url = url,
        .method = wav ? HTTP_METHOD_POST : HTTP_METHOD_GET,
        .timeout_ms = READ_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t h = esp_http_client_init(&c);
    esp_http_client_set_header(h, "x-charm-key", cfg.key);
    if (wav) esp_http_client_set_header(h, "Content-Type", "audio/wav");
    bool sent = esp_http_client_open(h, (int)len) == ESP_OK;
    for (size_t at = 0; sent && at < len;) {
        int n = esp_http_client_write(h, (const char *)wav + at, (int)(len - at));
        sent = n > 0;
        if (sent) at += (size_t)n;
    }
    int status = -1;
    if (sent) {
        esp_http_client_fetch_headers(h);
        status = esp_http_client_get_status_code(h);
    }
    if (status == 200) {
        face_set_mode(FACE_THINKING);
        play_answer(h);
    } else {
        ESP_LOGW(TAG, "her door answered %d", status);
    }
    esp_http_client_cleanup(h);
    face_set_level(0);
    return status;
}

static void confused(void) {
    face_set_mode(FACE_CONFUSED);
    vTaskDelay(pdMS_TO_TICKS(CONFUSED_MS));
}

void talk(void) {
    static uint8_t *wav;
    if (!wav) wav = heap_caps_malloc(WAV_HEADER + MAX_SAMPLES * 2, MALLOC_CAP_SPIRAM);

    face_set_mode(FACE_LISTENING);
    spoke = false;
    began = xTaskGetTickCount();
    size_t got = sound_record((int16_t *)(wav + WAV_HEADER), MAX_SAMPLES, heard);
    face_set_level(0);
    if (!spoke) { face_set_mode(FACE_IDLE); return; }

    face_set_mode(FACE_THINKING);
    wav_header(wav, got);
    if (knock(EUGENIA_DOOR, wav, WAV_HEADER + got * 2) != 200) confused();
    face_set_mode(FACE_IDLE);
}

bool talk_ready(void) {
    return knock(EUGENIA_DOOR "?briefing=ready", NULL, 0) == 200;
}

void talk_briefing(void) {
    face_set_mode(FACE_THINKING);
    int status = knock(EUGENIA_DOOR "?briefing=today", NULL, 0);
    if (status != 200 && status != 204) confused();
    face_set_mode(FACE_IDLE);
}
