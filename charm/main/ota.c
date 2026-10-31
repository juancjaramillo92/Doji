/* Updates over Wi-Fi. The charm workflow publishes every build of main to a
   public Storage bucket, its version the commit it was built from. Once a
   night she reads the newest image's description, from its first bytes; when
   the version differs from hers, the rest is written into her other app slot,
   which she starts from at her next wake. A new app is good only once it has
   proved itself (main.c's prove): her screen started and drawn on, and her
   Wi-Fi reached. One that never does — that freezes, crashes or never joins —
   is rolled back by the bootloader at the wake after, to the app that was. */
#include "ota.h"

#include <string.h>
#include "esp_app_desc.h"
#include "esp_attr.h"
#include "esp_crt_bundle.h"
#include "esp_https_ota.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "net.h"

static const char *TAG = "ota";

#define NIGHT_HOUR 3            // New York, between the nightly pass and the briefing
#define READ_MS    30000

static RTC_DATA_ATTR int looked;  // yyyymmdd of the last night's look

bool ota_due(time_t now) {
    struct tm t;
    localtime_r(&now, &t);
    int day = (t.tm_year + 1900) * 10000 + (t.tm_mon + 1) * 100 + t.tm_mday;
    if (now < CLOCK_SET || t.tm_hour != NIGHT_HOUR || day == looked) return false;
    looked = day;
    return true;
}

bool ota_offered(const char *version) {
    if (!version[0] || !strcmp(version, esp_app_get_description()->version)) return false;
    const esp_partition_t *failed = esp_ota_get_last_invalid_partition();
    esp_app_desc_t was;
    return !(failed && esp_ota_get_partition_description(failed, &was) == ESP_OK && !strcmp(was.version, version));
}

bool ota_update(void) {
    esp_http_client_config_t http = { .url = FIRMWARE_URL, .timeout_ms = READ_MS,
                                      .crt_bundle_attach = esp_crt_bundle_attach };
    esp_https_ota_config_t config = { .http_config = &http };
    esp_https_ota_handle_t h;
    if (esp_https_ota_begin(&config, &h) != ESP_OK) return false;
    esp_app_desc_t next;
    const char *mine = esp_app_get_description()->version;
    bool newer = esp_https_ota_get_img_desc(h, &next) == ESP_OK && ota_offered(next.version);
    esp_err_t err = ESP_OK;
    while (newer && (err = esp_https_ota_perform(h)) == ESP_ERR_HTTPS_OTA_IN_PROGRESS) {}
    // Finishing closes the update either way; anything short of it is abandoned.
    if (!newer || err != ESP_OK || !esp_https_ota_is_complete_data_received(h)) {
        esp_https_ota_abort(h);
        return false;
    }
    bool written = esp_https_ota_finish(h) == ESP_OK;
    ESP_LOGI(TAG, "%s %s over %s", next.version, written ? "written" : "refused", mine);
    return written;
}

bool ota_unproven(void) {
    esp_ota_img_states_t state;
    return esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK &&
           state == ESP_OTA_IMG_PENDING_VERIFY;
}

void ota_confirm(void) {
    esp_ota_mark_app_valid_cancel_rollback();
}
