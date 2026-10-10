/* The charm: Eugenia and Gladys on one board. Their Wi-Fi and their keys are
   the setup's, kept in flash; without them, or when asked by holding BOOT for
   five seconds (power.c), she shows the setup instead (setup.c).

   She lives in short waking spells, and whoever is needed is who wakes —
   decided before the screen lights, so waking is never a switch: Gladys when
   a trade waits for its journal, Eugenia otherwise. Gladys journals it and
   sleeps, unless a briefing waits too; only then does Eugenia slide in to read
   it. Awake, a tap is for whoever shows — Eugenia: he talks to her (talk.c);
   Gladys: she journals what waits (gladys.c) — a swipe across her face
   switches them, and AWAKE_MS without a tap puts her to sleep: her eyes close
   and the chip stops (sleep.c). A tap or the BOOT button wakes her.

   Asleep, she wakes on her own every CHECK_S, without lighting the screen, to
   ask Gladys's door what waits, with a soft double tick when something new
   does, and in the briefing's hours (briefing.c) Eugenia's whether it has
   landed; when it has, her face lights and she says so. The screen is started
   only when its marks must change: the panel keeps its picture while the chip
   sleeps, so most errands never touch it.

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

#define BRIGHTNESS    75     // percent
#define CHECK_S       300    // how often she asks what waits, around the clock
#define CHARGING_S    120    // on the cable, how often the charge is redrawn
#define AWAKE_MS      30000
#define GOODNIGHT_MS  1200   // her eyes closing
#define LAST_FRAME_MS 200    // the sleep screen reaching the panel
#define SLIDE_MS      500    // a switch, and a moment over

// What waits, and what the sleep screen last drew; both kept through sleep.
static RTC_DATA_ATTR bool briefing_waits, trade_waits;
static RTC_DATA_ATTR int drawn = -1;

static esp_sleep_wakeup_cause_t woke;
static TaskHandle_t life_task;
static volatile bool swiped;
static character_t showing;
static bool lit;

// A tap is for whoever shows, a swipe across her face switches them, and a
// slide round the rim is the volume.
static void on_touch(lv_event_t *e) {
    static bool gestured;
    lv_event_code_t code = lv_event_get_code(e);
    lv_point_t at;
    lv_indev_get_point(lv_indev_active(), &at);
    if (code == LV_EVENT_PRESSED) {
        gestured = false;
        dial_press(at);
    }
    if (code == LV_EVENT_PRESSING) dial_slide(at);
    if (code == LV_EVENT_GESTURE && !dial_turned() && !gestured) {
        lv_dir_t dir = lv_indev_get_gesture_dir(lv_indev_active());
        if (dir == LV_DIR_LEFT || dir == LV_DIR_RIGHT) {
            gestured = swiped = true;
            xTaskNotifyGive(life_task);
        }
    }
    if (code == LV_EVENT_RELEASED) dial_lift();
    if (code == LV_EVENT_SHORT_CLICKED && !dial_turned() && !gestured) xTaskNotifyGive(life_task);
}

// The screen, started once, with `who` showing in `mode`.
static void light(character_t who, face_mode_t mode) {
    if (lit) return;
    lit = true;
    showing = who;
    sleep_release();
    bsp_display_start();
    bsp_display_brightness_set(BRIGHTNESS);
    face_set_mode(mode);
    bsp_display_lock(-1);
    face_start(who);
    bsp_display_unlock();
}

// Her briefing has landed: lit for Eugenia to say so.
static void light_eugenia(void) { light(EUGENIA, FACE_THINKING); }

/* Goodnight, when her face is showing, then the sleep screen — drawn only
   when its marks differ from what the panel already holds — then deep sleep
   until the next errand. */
static void sleep_now(void) {
    int charge = power_charge();
    bool tired = power_low();
    int marks = briefing_waits | trade_waits << 1 | tired << 2 | (charge + 1) << 3;
    if (lit) {
        face_set_mode(FACE_ASLEEP);
        vTaskDelay(pdMS_TO_TICKS(GOODNIGHT_MS));
    }
    if (lit || marks != drawn) {
        light(showing, FACE_DARK);
        face_set_tired(tired);
        face_set_marks(briefing_waits, trade_waits, charge);
        face_set_mode(FACE_DARK);
        vTaskDelay(pdMS_TO_TICKS(LAST_FRAME_MS));
        drawn = marks;
    }
    sleep_until(time(NULL) + (charge >= 0 ? CHARGING_S : CHECK_S));
}

// In the dark: what waits for Gladys, and in its hours whether the briefing has.
static void errand(void) {
    if (net_start()) {
        int left = gladys_check();
        bool tick = left > 0 && !trade_waits, ask = briefing_due(time(NULL));
        if (tick || ask) {
            sound_start();
            sound_volume(cfg.volume);
        }
        if (tick) sound_tick();
        if (left >= 0) trade_waits = left > 0;
        if (ask && talk_ready(light_eugenia)) {
            briefing_waits = true;
            briefing_announced(time(NULL));
        }
    }
    sleep_now();
}

// Gladys journals what waits, and her dot follows what is left.
static void journal(void) {
    int left = gladys_journal();
    if (left >= 0) trade_waits = left > 0;
}

static void awake(void) {
    character_t who = trade_waits ? GLADYS : EUGENIA;
    face_set_tired(power_low());
    light(who, FACE_IDLE);
    bsp_display_lock(-1);
    lv_obj_t *screen = lv_screen_active();
    static const lv_event_code_t codes[] = { LV_EVENT_PRESSED, LV_EVENT_PRESSING, LV_EVENT_RELEASED,
                                             LV_EVENT_SHORT_CLICKED, LV_EVENT_GESTURE };
    for (size_t i = 0; i < sizeof codes / sizeof *codes; i++) lv_obj_add_event_cb(screen, on_touch, codes[i], NULL);
    bsp_display_unlock();

    sound_start();
    sound_volume(cfg.volume);
    if (woke == ESP_SLEEP_WAKEUP_UNDEFINED) sound_chime();  // switched on, not woken
    if (!net_start()) {
        ESP_LOGW(TAG, "none of her networks answered");
        face_set_offline(true);
    }

    // A press is for what waits first: Gladys's journal, then Eugenia's briefing.
    if (who == GLADYS) {
        journal();
        if (!briefing_waits) sleep_now();
        face_switch(showing = EUGENIA);
        vTaskDelay(pdMS_TO_TICKS(SLIDE_MS));
    }
    if (briefing_waits) {
        briefing_waits = false;
        talk_briefing();
    }

    while (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(AWAKE_MS))) {
        if (swiped) {
            swiped = false;
            face_switch(showing = showing == EUGENIA ? GLADYS : EUGENIA);
        } else if (showing == EUGENIA) {
            talk();
        } else {
            journal();
        }
    }
    sleep_now();
}

static void life(void *arg) {
    (void)arg;
    power_start();
    if (woke == ESP_SLEEP_WAKEUP_TIMER) errand();
    else awake();
}

void app_main(void) {
    woke = esp_sleep_get_wakeup_cause();
    config_load();

    // What the board turned out to be, for the first serial log.
    uint32_t flash = 0;
    esp_flash_get_size(NULL, &flash);
    ESP_LOGI(TAG, "flash %lu MB · PSRAM %u MB · woken by %d",
             (unsigned long)(flash >> 20), (unsigned)(esp_psram_get_size() >> 20), (int)woke);

    if (config_take_setup_request() || !config_ready()) {
        light(EUGENIA, FACE_DARK);
        setup_run();
    }
    // The stack holds a TLS handshake.
    xTaskCreatePinnedToCore(life, "life", 12288, NULL, 5, &life_task, 0);
}
