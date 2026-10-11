/* The charm: Eugenia and Gladys on one board. Their Wi-Fi and their keys are
   the setup's, kept in flash; without them, or when asked by holding BOOT for
   five seconds (power.c), she shows the setup instead (setup.c).

   She lives in short waking spells, and what waits decides what shows first,
   before the screen lights, so nothing flashes on the way: a trade waiting
   for its journal puts its questions up straight from the dark (gladys.c),
   with no face before them; the journal ends on the dark, and she sleeps,
   unless a briefing waits too, when Eugenia comes up from black to read it.
   Otherwise Eugenia wakes, and reads a waiting briefing at once. Awake, a tap
   and he talks to her (talk.c); a trade that came in while she spoke puts its
   questions up once she is done, and then she sleeps. AWAKE_MS without a tap
   puts her to sleep: her eyes close and the chip stops (sleep.c). Lifting her
   to look wakes her (motion.c), and so do a tap, PWR and BOOT. A lift that was not him looking — a swing, a
   bump — sends her straight back to sleep without lighting the screen, and
   rests the motion sensor for LIFT_REST_S, so a keyring swinging all day
   cannot keep waking her.

   Asleep, she wakes on her own every CHECK_S, without lighting the screen, to
   ask Gladys's door what waits, with a soft double tick when something new
   does, and in the briefing's hours (briefing.c) Eugenia's whether it has
   landed; when it has, her face lights and she says so. The screen is started
   only when its marks must change: the panel keeps its picture while the chip
   sleeps, so most errands never touch it. Once a night an errand also looks
   for a new app from main (ota.c).

   PWR is the power chip's (power.c): a press switches her on, and held she
   says goodnight and switches off. */
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
#include "motion.h"
#include "net.h"
#include "ota.h"
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
#define LAST_FRAME_MS 200    // the sleep screen reaching the panel
#define LIFT_REST_S   20     // the motion sensor's rest after a lift that was not him
#define EARLY_S       5      // how early a timer may wake her and still be the errand's

// What waits, what the sleep screen last drew, and when the next errand is;
// all kept through sleep.
static RTC_DATA_ATTR bool briefing_waits, trade_waits;
static RTC_DATA_ATTR int drawn = -1;
static RTC_DATA_ATTR time_t errand_at;

static esp_sleep_wakeup_cause_t woke;
static TaskHandle_t life_task;
static bool lit;

// A tap on her face is for Eugenia, and a slide round the rim is the volume.
static void on_touch(lv_event_t *e) {
    lv_event_code_t code = lv_event_get_code(e);
    lv_point_t at;
    lv_indev_get_point(lv_indev_active(), &at);
    if (code == LV_EVENT_PRESSED) dial_press(at);
    if (code == LV_EVENT_PRESSING) dial_slide(at);
    if (code == LV_EVENT_RELEASED) dial_lift();
    if (code == LV_EVENT_SHORT_CLICKED && !dial_turned()) xTaskNotifyGive(life_task);
}

// The screen, started once, in `mode`.
static void light(face_mode_t mode) {
    if (lit) return;
    lit = true;
    sleep_release();
    bsp_display_start();
    bsp_display_brightness_set(BRIGHTNESS);
    face_set_mode(mode);
    bsp_display_lock(-1);
    face_start();
    bsp_display_unlock();
}

// Her briefing has landed: lit for Eugenia to say so.
static void light_eugenia(void) { light(FACE_THINKING); }

/* Goodnight, when her face is showing — the journal leaves the dark already
   up — then the sleep screen, drawn only when its marks differ from what the
   panel already holds, then deep sleep until the next errand, the motion
   sensor armed. */
static void sleep_now(void) {
    int charge = power_charge();
    bool tired = power_low();
    int marks = briefing_waits | trade_waits << 1 | tired << 2 | (charge + 1) << 3;
    if (lit && face_get_mode() != FACE_DARK) {
        face_set_mode(FACE_ASLEEP);
        vTaskDelay(pdMS_TO_TICKS(FACE_GOODNIGHT_MS));
    }
    if (lit || marks != drawn) {
        light(FACE_DARK);
        face_set_tired(tired);
        face_set_marks(briefing_waits, trade_waits, charge);
        face_set_mode(FACE_DARK);
        vTaskDelay(pdMS_TO_TICKS(LAST_FRAME_MS));
        drawn = marks;
    }
    errand_at = time(NULL) + (charge >= 0 ? CHARGING_S : CHECK_S);
    motion_arm();
    sleep_until(errand_at, true);
}

// Asks Gladys's door, and says whether a trade came in that did not wait before.
static bool trade_came(void) {
    int left = gladys_check();
    bool came = left > 0 && !trade_waits;
    if (left >= 0) trade_waits = left > 0;
    return came;
}

// In the dark: what waits for Gladys, and in its hours whether the briefing has.
static void errand(void) {
    net_start();
    if (net_wait(NET_ALL_MS)) {
        ota_confirm();
        bool tick = trade_came(), ask = briefing_due(time(NULL));
        if (tick || ask) {
            sound_start();
            sound_volume(cfg.volume);
        }
        if (tick) sound_tick();
        if (ask && talk_ready(light_eugenia)) {
            briefing_waits = true;
            briefing_announced(time(NULL));
        }
        // A new app from main, in the small hours: she wakes into it at once,
        // quietly, for this errand's place.
        if (ota_due(time(NULL)) && !power_low() && ota_update()) {
            errand_at = time(NULL);
            sleep_until(errand_at, false);
        }
    }
    sleep_now();
}

// The journal of what waits; the sleep screen's mark follows what is left.
static void journal(void) {
    int left = gladys_journal();
    if (left >= 0) trade_waits = left > 0;
}

static void awake(void) {
    // A trade waiting: the screen stays dark until its questions cover it.
    bool trade = trade_waits;
    face_set_tired(power_low());
    light(trade ? FACE_DARK : FACE_IDLE);
    bsp_display_lock(-1);
    lv_obj_t *screen = lv_screen_active();
    static const lv_event_code_t codes[] = { LV_EVENT_PRESSED, LV_EVENT_PRESSING, LV_EVENT_RELEASED,
                                             LV_EVENT_SHORT_CLICKED };
    for (size_t i = 0; i < sizeof codes / sizeof *codes; i++) lv_obj_add_event_cb(screen, on_touch, codes[i], NULL);
    bsp_display_unlock();

    // Joining runs beside everything else: she listens while it does, and
    // waits for it only to send.
    net_start();
    sound_start();
    sound_volume(cfg.volume);
    if (esp_reset_reason() == ESP_RST_POWERON) sound_chime();  // switched on, not woken or restarted

    // What waits goes first: the journal, then the briefing, which brings her
    // face up from the dark the journal left.
    if (trade) {
        journal();
        if (!briefing_waits) sleep_now();
    }
    bool spoke = false;
    if (briefing_waits) {
        briefing_waits = false;
        spoke = talk_briefing();
    }

    for (;;) {
        // A trade that came in while she spoke: its questions once she is done,
        // and only then, so nothing interrupts her.
        if (spoke && trade_came()) {
            journal();
            sleep_now();
        }
        if (!ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(AWAKE_MS))) sleep_now();
        spoke = talk();
    }
}

static void life(void *arg) {
    (void)arg;
    power_start();
    // A lift that was not him: back to sleep at once, the sensor resting.
    if (woke == ESP_SLEEP_WAKEUP_EXT1 && (esp_sleep_get_ext1_wakeup_status() & (1ULL << MOTION_PIN)) && !motion_looked()) {
        time_t rest = time(NULL) + LIFT_REST_S;
        sleep_until(rest < errand_at ? rest : errand_at, false);
    }
    if (woke == ESP_SLEEP_WAKEUP_TIMER && time(NULL) + EARLY_S < errand_at) {
        // The rest is over before the errand is due: armed again, nothing else.
        // A timer a moment early is the errand's own.
        motion_arm();
        sleep_until(errand_at, true);
    }
    if (woke == ESP_SLEEP_WAKEUP_TIMER) errand();
    else awake();
}

void app_main(void) {
    woke = esp_sleep_get_wakeup_cause();
    sleep_woke();
    config_load();

    // What the board turned out to be, for the first serial log.
    uint32_t flash = 0;
    esp_flash_get_size(NULL, &flash);
    ESP_LOGI(TAG, "flash %lu MB · PSRAM %u MB · woken by %d",
             (unsigned long)(flash >> 20), (unsigned)(esp_psram_get_size() >> 20), (int)woke);

    if (config_take_setup_request() || !config_ready()) {
        light(FACE_DARK);
        setup_run();
    }
    // The stack holds a TLS handshake.
    xTaskCreatePinnedToCore(life, "life", 12288, NULL, 5, &life_task, 0);
}
