/* The charm. The board comes up as Eugenia or Gladys — which, her Wi-Fi and
   her key are the setup page's, kept in flash — with her face alive on screen.
   Without a network or a key, or when asked by holding the screen for ten
   seconds, she shows the setup page instead.

   She lives in short waking spells. Awake, a tap is for her — Eugenia: he
   talks to her (talk.c); Gladys: she journals what waits (gladys.c) — and
   AWAKE_MS without one puts her to sleep: her eyes close and the chip stops
   (sleep.c). A tap or the BOOT button wakes her, and that press is for what
   waits first. She also wakes on her own, in the dark: Eugenia after the
   briefing's hour (briefing.c) to ask whether it has landed, saying so when it
   has; Gladys every few minutes to ask what waits, with a soft double tick
   when something new does. Either then sleeps with her still dot up.

   PWR is the power chip's (power.c): a press switches her on, held while she
   is awake she says goodnight and switches off. */
#include "bsp/esp-bsp.h"
#include "esp_attr.h"
#include "esp_flash.h"
#include "esp_log.h"
#include "esp_psram.h"
#include "esp_sleep.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"

#include "briefing.h"
#include "config.h"
#include "dial.h"
#include "face.h"
#include "gladys.h"
#include "net.h"
#include "power.h"
#include "setup.h"
#include "sleep.h"
#include "sound.h"
#include "talk.h"

static const char *TAG = "charm";

#define SETUP_HOLD_MS 10000
#define AWAKE_MS      30000
#define GOODNIGHT_MS  1200   // her eyes closing
#define LAST_FRAME_MS 200    // the dark, or the dot, reaching the panel

static RTC_DATA_ATTR bool waiting;  // her dot is up: a briefing, or a trade, waits for him

static esp_sleep_wakeup_cause_t woke;
static TaskHandle_t life_task;

// A tap is for her, a slide round the rim is the volume, and ten seconds held
// opens the setup page.
static void on_touch(lv_event_t *e) {
    static uint32_t pressed_at;
    static bool asked;
    lv_event_code_t code = lv_event_get_code(e);
    lv_point_t at;
    lv_indev_get_point(lv_indev_active(), &at);
    if (code == LV_EVENT_PRESSED) {
        pressed_at = lv_tick_get();
        asked = false;
        dial_press(at);
    }
    if (code == LV_EVENT_PRESSING) dial_slide(at);
    if (code == LV_EVENT_PRESSING && !asked && lv_tick_elaps(pressed_at) > SETUP_HOLD_MS) {
        asked = true;
        config_ask_setup();
        esp_restart();
    }
    if (code == LV_EVENT_RELEASED) dial_lift();
    if (code == LV_EVENT_SHORT_CLICKED && !dial_turned()) xTaskNotifyGive(life_task);
}

// From the dark there is nothing to close.
static void sleep_now(bool lit) {
    if (lit) {
        face_set_mode(FACE_ASLEEP);
        vTaskDelay(pdMS_TO_TICKS(GOODNIGHT_MS));
    }
    face_set_mode(waiting ? FACE_DOT : FACE_DARK);
    vTaskDelay(pdMS_TO_TICKS(LAST_FRAME_MS));
    sleep_until(cfg.gladys ? time(NULL) + cfg.check_min * 60 : briefing_next_ask(time(NULL)));
}

// Gladys journals what waits, and her dot follows what is left.
static void journal(void) {
    int left = gladys_journal();
    if (left >= 0) waiting = left > 0;
}

static void life(void *arg) {
    (void)arg;
    sound_start();
    sound_volume(cfg.volume);
    if (woke == ESP_SLEEP_WAKEUP_UNDEFINED) sound_chime();  // switched on, not woken
    if (!net_start()) ESP_LOGW(TAG, "none of her networks answered");

    if (woke == ESP_SLEEP_WAKEUP_TIMER) {
        bool lit = false;
        if (cfg.gladys) {
            int left = gladys_check();
            if (left > 0 && !waiting) sound_tick();
            if (left >= 0) waiting = left > 0;
        } else if ((lit = talk_ready())) {
            waiting = true;
            briefing_announced(time(NULL));
        }
        // A tap meanwhile turns the errand into a waking spell, and is a press.
        if (!ulTaskNotifyTake(pdTRUE, 0)) sleep_now(lit);
        face_set_mode(FACE_IDLE);
    }

    // A press is for what waits first.
    if (cfg.gladys) journal();
    else if (waiting) {
        waiting = false;
        talk_briefing();
    }

    while (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(AWAKE_MS))) {
        if (cfg.gladys) journal();
        else talk();
    }
    sleep_now(true);
}

void app_main(void) {
    sleep_release();
    woke = esp_sleep_get_wakeup_cause();
    config_load();
    bool setup = config_take_setup_request() || !config_ready();

    // What the board turned out to be, for the first serial log.
    uint32_t flash = 0;
    esp_flash_get_size(NULL, &flash);
    ESP_LOGI(TAG, "%s · flash %lu MB · PSRAM %u MB · woken by %d", cfg.gladys ? "Gladys" : "Eugenia",
             (unsigned long)(flash >> 20), (unsigned)(esp_psram_get_size() >> 20), (int)woke);

    bsp_display_start();
    bsp_display_brightness_set(cfg.brightness);
    power_start();
    face_set_tired(power_low());

    // An errand starts in the dark, or with her dot still up.
    if (woke == ESP_SLEEP_WAKEUP_TIMER) face_set_mode(waiting ? FACE_DOT : FACE_DARK);
    bsp_display_lock(-1);
    face_start(cfg.gladys);
    bsp_display_unlock();
    if (setup) setup_run();

    // The stack holds a TLS handshake.
    xTaskCreatePinnedToCore(life, "life", 12288, NULL, 5, &life_task, 0);

    bsp_display_lock(-1);
    lv_obj_t *screen = lv_screen_active();
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_PRESSED, NULL);
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_PRESSING, NULL);
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_RELEASED, NULL);
    lv_obj_add_event_cb(screen, on_touch, LV_EVENT_SHORT_CLICKED, NULL);
    bsp_display_unlock();
}
