/* Gladys's door. A GET answers what waits for its journal; a POST is one
   answer, in the grammar of a Telegram tap (PID…|rules|1), and answers what
   waits after it, so the journal moves on without a second request. */
#include "gladys.h"

#include <stdio.h>
#include <string.h>
#include "cJSON.h"
#include "config.h"
#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "face.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "journal.h"
#include "net.h"

static const char *TAG = "gladys";

// What waits: how many trades, and the oldest of them.
typedef struct {
    int waiting;
    char id[24];
    bool missing[4];  // setup, rules, stop loss, take profit
} trade_t;

/* The four answers as her door takes them, a key of its COLUMNS and the column
   that key writes, and the two setups by their names. Copies of COLUMNS and
   SETUPS in doji-gladys, which agree.test.mjs holds them against. */
static const struct { const char *key, *column; } ANSWERS[4] = {
    { "setup", "setup" },
    { "rules", "followed_rules" },
    { "sl",    "followed_sl" },
    { "tp",    "followed_tp" },
};
static const char *const SETUPS[2] = { "Break & Retest", "Support & Resistance" };

// The newest app the workflow published, as her door last said; empty when it did not.
static char newest[32];

#define READ_MS    15000

static bool read_answer(const char *body, trade_t *t) {
    cJSON *root = cJSON_Parse(body);
    const cJSON *waiting = cJSON_GetObjectItem(root, "waiting");
    const cJSON *trade = cJSON_GetObjectItem(root, "trade");
    bool ok = cJSON_IsNumber(waiting);
    const cJSON *app = cJSON_GetObjectItem(root, "app");
    snprintf(newest, sizeof newest, "%s", cJSON_IsString(app) ? app->valuestring : "");
    if (ok) {
        t->waiting = waiting->valueint;
        const cJSON *id = cJSON_GetObjectItem(trade, "id");
        snprintf(t->id, sizeof t->id, "%s", cJSON_IsString(id) ? id->valuestring : "");
        for (int q = 0; q < 4; q++) {
            const cJSON *v = cJSON_GetObjectItem(trade, ANSWERS[q].column);
            t->missing[q] = !v || cJSON_IsNull(v);
        }
        if (!t->id[0]) t->waiting = 0;
    }
    cJSON_Delete(root);
    return ok;
}

/* A GET when `body` is NULL, else a POST of it. One connection serves the
   whole waking — a journal's every answer is a request, and a new TLS
   handshake costs about a second — so an answer read to its end leaves it
   ready for the next, and one that is not closes it. One kept from before that her door has closed since
   is tried once more afresh. */
static bool knock(const char *body, trade_t *t) {
    static esp_http_client_handle_t h;
    if (!net_wait(NET_ALL_MS)) return false;
    if (!h) {
        esp_http_client_config_t c = {
            .url = GLADYS_DOOR,
            .timeout_ms = READ_MS,
            .crt_bundle_attach = esp_crt_bundle_attach,
        };
        h = esp_http_client_init(&c);
        esp_http_client_set_header(h, "x-charm-key", cfg.gladys_key);
        esp_http_client_set_header(h, "Content-Type", "application/json");
    }
    esp_http_client_set_method(h, body ? HTTP_METHOD_POST : HTTP_METHOD_GET);
    int len = body ? (int)strlen(body) : 0, status = -1;
    for (int tries = 0; tries < 2 && status < 0; tries++) {
        bool kept = esp_http_client_get_socket(h) >= 0;
        if (esp_http_client_open(h, len) == ESP_OK && (!body || esp_http_client_write(h, body, len) == len) &&
            esp_http_client_fetch_headers(h) >= 0) {
            status = esp_http_client_get_status_code(h);
        }
        if (status < 0) esp_http_client_close(h);
        if (!kept) break;
    }
    static char got[2048];
    int have = 0;
    if (status >= 0) {
        for (int n; have < (int)sizeof got - 1 &&
                    (n = esp_http_client_read(h, got + have, sizeof got - 1 - have)) > 0;) have += n;
        // An answer not read to its end leaves the line mid-answer: closed,
        // never drained — a drain waits on its read with no end when the
        // rest never comes.
        if (!esp_http_client_is_complete_data_received(h)) esp_http_client_close(h);
        if (status != 200) ESP_LOGW(TAG, "her door answered %d", status);
    } else {
        ESP_LOGW(TAG, "her door could not be reached");
    }
    got[have] = 0;
    return status == 200 && read_answer(got, t);
}

const char *gladys_app(void) { return newest; }

int gladys_check(void) {
    trade_t t;
    return knock(NULL, &t) ? t.waiting : -1;
}

int gladys_journal(void) {
    trade_t t;
    bool reached = knock(NULL, &t), shown = false, all_yes = true, answered = false;
    while (reached && t.waiting > 0) {
        int q = 0;
        while (q < 3 && !t.missing[q]) q++;
        shown = true;
        int half = journal_ask(q, t.missing);
        if (half < 0) break;
        all_yes &= q == 0 || half;
        char body[96];
        snprintf(body, sizeof body, "{\"data\":\"%s|%s|%s\"}", t.id, ANSWERS[q].key,
                 q == 0 ? SETUPS[half] : half ? "1" : "0");
        // An answer her door did not take, the network still up, leaves the
        // question where it was to be tapped again: its not moving on is the
        // sign it was not saved. With the network gone, the journal ends.
        reached = knock(body, &t) || net_wait(0);
        answered = true;
    }
    if (reached && answered && t.waiting == 0) journal_done(all_yes);
    // The journal gives way to the dark, never to a face: the sleep screen is
    // put under it first, so taking it away shows nothing in between. The
    // face's next frame puts the dark up, and a frame more sees it drawn.
    if (shown) {
        face_set_mode(FACE_DARK);
        vTaskDelay(pdMS_TO_TICKS(2 * FACE_FRAME_MS));
    }
    journal_hide();
    return reached ? t.waiting : -1;
}
