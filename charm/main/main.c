/* The charm. The board comes up as Eugenia or Gladys — which, her Wi-Fi and
   her key are the setup page's, kept in flash — with her face alive on screen
   and a chime. Without a network or a key, or when asked by holding the screen
   for ten seconds, she shows the setup page instead. Otherwise she joins her
   Wi-Fi and sets her clock to New York.

   Eugenia: a tap and he talks to her, and she answers (talk.c). */
#include "bsp/esp-bsp.h"
#include "esp_flash.h"
#include "esp_log.h"
#include "esp_psram.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"

#include "config.h"
#include "face.h"
#include "net.h"
#include "setup.h"
#include "sound.h"
#include "talk.h"

static const char *TAG = "charm";

#define SETUP_HOLD_MS 10000

static TaskHandle_t audio_task;

// A tap is for the audio task; ten seconds held opens the setup page.
static void on_touch(lv_event_t *e) {
    static uint32_t pressed_at;
    static bool asked;
    lv_event_code_t code = lv_event_get_code(e);
    if (code == LV_EVENT_PRESSED) { pressed_at = lv_tick_get(); asked = false; }
    if (code == LV_EVENT_PRESSING && !asked && lv_tick_elaps(pressed_at) > SETUP_HOLD_MS) {
        asked = true;
        config_ask_setup();
        esp_restart();
    }
    if (code == LV_EVENT_SHORT_CLICKED) xTaskNotifyGive(audio_task);
}

static void net_task(void *arg) {
    (void)arg;
    if (!net_start()) ESP_LOGW(TAG, "none of her networks answered");
    vTaskDelete(NULL);
}

static void audio_loop(void *arg) {
    (void)arg;
    sound_start();
    sound_chime();
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        if (!cfg.gladys) talk();
    }
}

void app_main(void) {
    config_load();
    bool setup = config_take_setup_request() || !config_ready();

    // What the board turned out to be, for the first serial log.
    uint32_t flash = 0;
    esp_flash_get_size(NULL, &flash);
    ESP_LOGI(TAG, "%s · flash %lu MB · PSRAM %u MB", cfg.gladys ? "Gladys" : "Eugenia",
             (unsigned long)(flash >> 20), (unsigned)(esp_psram_get_size() >> 20));

    bsp_display_start();
    bsp_display_brightness_set(cfg.brightness);

    // Before the touch handler that wakes it can run. The stack holds a TLS
    // handshake.
    xTaskCreatePinnedToCore(audio_loop, "audio", 12288, NULL, 5, &audio_task, 0);

    bsp_display_lock(-1);
    face_start(cfg.gladys);
    lv_obj_t *screen = lv_screen_active();
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_PRESSED, NULL);
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_PRESSING, NULL);
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_SHORT_CLICKED, NULL);
    bsp_display_unlock();

    if (setup) setup_run();
    xTaskCreate(net_task, "net", 6144, NULL, 4, NULL);
}
