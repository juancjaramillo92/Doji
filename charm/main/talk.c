/* Eugenia's door, each exchange one request. He presses PWR and talks, as
   long as he likes and pausing as long as he needs, until he presses it
   again or five minutes are up; the recording is encoded as he speaks, Opus
   in an Ogg file as a Telegram voice note is, and goes to her door with what
   the charm knows of itself — its battery and its volume — in the headers.
   The briefing is a GET. What comes back is in frames (frames.h): her raw
   voice, 24 kHz mono, played as it arrives — silence while she thinks, which
   her face shows as thinking, then her voice with her mouth following it —
   and a volume she set, ahead of it. */
#include "talk.h"

#include <stdio.h>
#include <stdlib.h>
#include "config.h"
#include "esp_attr.h"
#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_opus_enc.h"
#include "esp_random.h"
#include "face.h"
#include "frames.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "net.h"
#include "ogg.h"
#include "power.h"
#include "sound.h"

static const char *TAG = "talk";

#define BITRATE  24000           // speech, for a transcriber, with room to spare
#define FRAME_MS 20              // the encoder's frame, as each Ogg page counts it
#define MAX_MS   (5 * 60 * 1000)
#define WARN_MS  (MAX_MS - 30000)
// Five minutes at BITRATE with every page's head, and room for the peaks a
// variable rate brings: under her door's 3 MB.
#define FILE_ROOM (2 * 1024 * 1024)
#define HER_RATE 24000

// A reading, not a fact: what counts as his voice. And how long she waits
// for him to start before dropping the turn: he pressed, then said nothing.
#define VOICE     0.12f
#define SILENT_MS 30000

// Her door sends a beat of silence every 15 s while she thinks; twice that
// with nothing is a dead line.
#define READ_MS 30000
#define CONFUSED_MS 4000

static TickType_t began;
static bool spoke, speaking, warned;
static uint32_t heard_ms;

// The recording as it is made: a frame of samples filling, the encoder it
// goes to, and the file each packet lands in.
static void *encoder;
static int16_t *frame;
static uint8_t *packet;
static int frame_bytes, packet_bytes, filled;
static ogg_t file;

// The battery line is hers to say once a charge: told, until a cable is in.
static RTC_DATA_ATTR bool told_low;

// PWR is a notification to this task: it ends his turn or cuts her off.
static bool tapped(void) { return ulTaskNotifyTake(pdTRUE, 0); }

/* His pauses are his own: once he has spoken only PWR ends the turn, or
   five minutes, a soft tick saying so half a minute before. The mics wait
   while the tick plays, a fifth of a second the recording does not keep. */
static bool heard(const int16_t *in, size_t n, float loud) {
    face_set_level(loud);
    for (size_t i = 0; i < n; i++) {
        frame[filled++] = in[i];
        if (filled * 2 < frame_bytes) continue;
        filled = 0;
        esp_audio_enc_in_frame_t raw = { .buffer = (uint8_t *)frame, .len = (uint32_t)frame_bytes };
        esp_audio_enc_out_frame_t coded = { .buffer = packet, .len = (uint32_t)packet_bytes };
        if (esp_opus_enc_process(encoder, &raw, &coded) != ESP_AUDIO_ERR_OK ||
            !ogg_packet(&file, packet, coded.encoded_bytes, FRAME_MS)) return false;
        heard_ms += FRAME_MS;
    }
    if (heard_ms >= WARN_MS && !warned) { warned = true; sound_tick(); }
    if (heard_ms >= MAX_MS || tapped()) return false;
    if (loud > VOICE) spoke = true;
    return spoke || xTaskGetTickCount() - began < pdMS_TO_TICKS(SILENT_MS);
}

// Her silence is exact zeros, so the first sound above nothing is her voice.
static bool said(float loud) {
    if (tapped()) return false;
    if (loud > 0 && !speaking) { speaking = true; face_set_mode(FACE_SPEAKING); }
    face_set_level(loud);
    return true;
}

// Plays her answer as it streams in, and sets the volume she asked for, as
// the dial does, before the voice that follows it.
static void play_answer(esp_http_client_handle_t h) {
    static uint8_t in[4096];
    static int16_t voice[sizeof in / 2 + 1];
    frames_t f = { 0 };
    speaking = false;
    for (;;) {
        face_set_level(0);
        int n = esp_http_client_read(h, (char *)in, sizeof in);
        if (n <= 0) return;
        int volume = -1;
        size_t samples = frames_read(&f, in, (size_t)n, voice, &volume);
        if (volume >= 0) {
            sound_volume(volume);
            cfg.volume = volume;
            config_save();
        }
        if (!sound_play(voice, samples, HER_RATE, said)) return;
    }
}

/* Knocks at her door — a POST of `ogg` when there is one, else a GET of
   `url` — and plays the answer when it is 200, after `lit`, when there is
   one, has lit the screen for her. Returns the status, or -1 when the door
   could not be reached. */
static int knock(const char *url, const uint8_t *ogg, size_t len, void (*lit)(void)) {
    esp_http_client_config_t c = {
        .url = url,
        .method = ogg ? HTTP_METHOD_POST : HTTP_METHOD_GET,
        .timeout_ms = READ_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    if (!net_wait(NET_ALL_MS)) return -1;
    esp_http_client_handle_t h = esp_http_client_init(&c);
    esp_http_client_set_header(h, "x-charm-key", cfg.eugenia_key);
    bool low = false;
    if (ogg) {
        char battery[8], volume[8];
        int percent = power_battery();
        bool charging = power_charge() >= 0;
        if (charging) told_low = false;
        low = power_low() && !told_low;
        snprintf(battery, sizeof battery, "%d", percent);
        snprintf(volume, sizeof volume, "%d", cfg.volume);
        esp_http_client_set_header(h, "Content-Type", "audio/ogg");
        if (percent >= 0) esp_http_client_set_header(h, "x-charm-battery", battery);
        esp_http_client_set_header(h, "x-charm-charging", charging ? "1" : "0");
        esp_http_client_set_header(h, "x-charm-volume", volume);
        if (low) esp_http_client_set_header(h, "x-charm-low", "1");
    }
    bool sent = esp_http_client_open(h, (int)len) == ESP_OK;
    for (size_t at = 0; sent && at < len;) {
        int n = esp_http_client_write(h, (const char *)ogg + at, (int)(len - at));
        sent = n > 0;
        if (sent) at += (size_t)n;
    }
    int status = -1;
    if (sent) {
        esp_http_client_fetch_headers(h);
        status = esp_http_client_get_status_code(h);
    }
    if (status == 200) {
        told_low |= low;
        if (lit) lit();
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

int talk(void) {
    static uint8_t *room;
    if (!room) room = heap_caps_malloc(FILE_ROOM, MALLOC_CAP_SPIRAM);
    esp_opus_enc_config_t opus = ESP_OPUS_ENC_CONFIG_DEFAULT();
    opus.sample_rate = SOUND_RATE;
    opus.channel = ESP_AUDIO_MONO;
    opus.bitrate = BITRATE;
    opus.frame_duration = ESP_OPUS_ENC_FRAME_DURATION_20_MS;
    opus.enable_vbr = true;
    bool ready = room && esp_opus_enc_open(&opus, sizeof opus, &encoder) == ESP_AUDIO_ERR_OK;
    if (ready && (!frame || !packet)) {
        esp_opus_enc_get_frame_size(encoder, &frame_bytes, &packet_bytes);
        if (!frame) frame = malloc((size_t)frame_bytes);
        if (!packet) packet = malloc((size_t)packet_bytes);
        if (!frame || !packet) { esp_opus_enc_close(encoder); ready = false; }
    }
    if (!ready) {
        ESP_LOGE(TAG, "no encoder, or no room to record");
        confused();
        face_set_mode(FACE_IDLE);
        return 0;
    }
    ogg_start(&file, room, FILE_ROOM, esp_random(), SOUND_RATE);

    sound_listen();
    face_set_mode(FACE_LISTENING);
    spoke = warned = false;
    heard_ms = 0;
    filled = 0;
    began = xTaskGetTickCount();
    sound_record(heard);
    esp_opus_enc_close(encoder);
    face_set_level(0);
    if (!spoke) { face_set_mode(FACE_IDLE); return 0; }

    sound_sent();
    face_set_mode(FACE_THINKING);
    int status = knock(EUGENIA_DOOR, room, ogg_end(&file), NULL);
    if (status > 0 && status != 200) confused();
    face_set_mode(FACE_IDLE);
    return status;
}

bool talk_ready(void (*lit)(void)) {
    return knock(EUGENIA_DOOR "?briefing=ready", NULL, 0, lit) == 200;
}

int talk_briefing(void) {
    tapped();  // a press left over from before — during her confused face — is not a word to her
    face_set_mode(FACE_THINKING);
    int status = knock(EUGENIA_DOOR "?briefing=today", NULL, 0, NULL);
    if (status > 0 && status != 200 && status != 204) confused();
    face_set_mode(FACE_IDLE);
    return status;
}
