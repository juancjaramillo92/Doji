/* The charm, first milestone: the board comes up as Eugenia or Gladys, her face
   lives on screen, the speaker chimes, and a tap records three seconds and
   plays them back with her mouth moving to it — screen, touch, both
   microphones and the speaker proved before any of Wi-Fi or the doors.

   Which of the two she is lives in flash (NVS "charm"/"who"). Until the setup
   page exists, holding the screen for five seconds switches it and restarts. */
#include <string.h>
#include "bsp/esp-bsp.h"
#include "esp_chip_info.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_psram.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "nvs.h"
#include "nvs_flash.h"

#include "face.h"
#include "sound.h"

static const char *TAG = "charm";

#define BRIGHTNESS   75   // percent: bright enough, and kinder to the battery and the panel
#define TEST_SECONDS 3
#define SWITCH_MS    5000

static TaskHandle_t audio_task;
static bool gladys;

static bool read_who(void) {
    nvs_handle_t h;
    char who[16] = "eugenia";
    size_t len = sizeof who;
    if (nvs_open("charm", NVS_READONLY, &h) == ESP_OK) {
        nvs_get_str(h, "who", who, &len);
        nvs_close(h);
    }
    return strcmp(who, "gladys") == 0;
}

static void write_who(bool g) {
    nvs_handle_t h;
    if (nvs_open("charm", NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_str(h, "who", g ? "gladys" : "eugenia");
    nvs_commit(h);
    nvs_close(h);
}

// A tap starts the test; five seconds held switches who she is.
static void on_touch(lv_event_t *e) {
    static uint32_t pressed_at;
    static bool switched;
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_PRESSED) { pressed_at = lv_tick_get(); switched = false; }
    if (code == LV_EVENT_PRESSING && !switched && lv_tick_elaps(pressed_at) > SWITCH_MS) {
        switched = true;
        write_who(!gladys);
        ESP_LOGI(TAG, "switching to %s", gladys ? "eugenia" : "gladys");
        esp_restart();
    }
    if (code == LV_EVENT_SHORT_CLICKED) xTaskNotifyGive(audio_task);
}

static void audio_loop(void *arg) {
    (void)arg;
    sound_start();
    sound_chime();

    size_t max = 16000 * TEST_SECONDS;
    int16_t *clip = heap_caps_malloc(max * sizeof(int16_t), MALLOC_CAP_SPIRAM);
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        face_set_mode(FACE_LISTENING);
        size_t got = sound_record(clip, max, face_set_level);
        face_set_mode(FACE_SPEAKING);
        sound_play(clip, got, face_set_level);
        face_set_mode(FACE_IDLE);
    }
}

void app_main(void) {
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }
    gladys = read_who();

    // What the board turned out to be, for the first serial log.
    uint32_t flash = 0;
    esp_flash_get_size(NULL, &flash);
    ESP_LOGI(TAG, "%s · flash %lu MB · PSRAM %u MB", gladys ? "Gladys" : "Eugenia",
             (unsigned long)(flash >> 20), (unsigned)(esp_psram_get_size() >> 20));

    bsp_display_start();
    bsp_display_brightness_set(BRIGHTNESS);

    // Before the touch handler that wakes it can run.
    xTaskCreatePinnedToCore(audio_loop, "audio", 6144, NULL, 5, &audio_task, 0);

    bsp_display_lock(-1);
    face_start(gladys);
    lv_obj_t *screen = lv_screen_active();
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_PRESSED, NULL);
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_PRESSING, NULL);
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_SHORT_CLICKED, NULL);
    bsp_display_unlock();
}
