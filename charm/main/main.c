/* The charm: Eugenia and Gladys on one board. Their Wi-Fi and their keys are
   the setup's, kept in flash; without them, or when asked by holding BOOT for
   five seconds (power.c), she shows the setup instead (setup.c).

   She lives in short waking spells, and what waits decides what shows first,
   before the screen lights, so nothing flashes on the way: a trade waiting
   for its journal puts its questions up straight from the dark (gladys.c),
   with no face before them; the journal ends on the dark, and she sleeps,
   unless a briefing waits too, when Eugenia comes up from black to read it.
   Otherwise Eugenia wakes, and reads a waiting briefing at once. PWR is the
   talk button (power.c, talk.c): a press and she listens, the next sends; from
   sleep, the press that wakes her has her listening before anything else, a
   waiting trade's questions coming after her answer. A trade that came in
   while she spoke puts its questions up once she is done, and then she
   sleeps; if he has put her down to listen, she sleeps at once and the trade
   waits under its mark. A waiting briefing is read either way: he is near,
   listening. Awake, she feels about once a second whether she is held up to
   look, which keeps her awake, or has been put down, which puts her to sleep
   a couple of seconds later; otherwise AWAKE_MS without a press does: her eyes
   close and the chip stops (sleep.c). Lifting her to look wakes her
   (motion.c), and so do a tap on the screen, PWR and BOOT. With no
   internet when she last looked she stays on her lock screen, its mark saying
   why, unless the network answers within OFFLINE_TRY_MS; and losing it while
   they talk sends her back there. A lift that was not him looking — a swing, a
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

   PWR is also the power chip's (power.c): off, a press switches her on, and
   held three seconds she says goodnight and switches off. */
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
#define OFFLINE_TRY_MS 8000  // woken offline, how long the network has to answer
#define LOOK_MS       1000   // awake and idle, how often she feels whether she is held
#define DOWN_READS    2      // put down this many readings running, she sleeps

// What waits, whether the internet answered last time, what the sleep screen
// last drew, and when the next errand is; all kept through sleep.
static RTC_DATA_ATTR bool briefing_waits, trade_waits, offline;
static RTC_DATA_ATTR int drawn = -1;
static RTC_DATA_ATTR time_t errand_at;

static esp_sleep_wakeup_cause_t woke;
static bool lit, journaled;

// A slide round the rim is the volume; a tap on a question is the journal's.
static void on_touch(lv_event_t *e) {
    lv_event_code_t code = lv_event_get_code(e);
    lv_point_t at;
    lv_indev_get_point(lv_indev_active(), &at);
    if (code == LV_EVENT_PRESSED) dial_press(at);
    if (code == LV_EVENT_PRESSING) dial_slide(at);
    if (code == LV_EVENT_RELEASED) dial_lift();
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
    bool low = power_low();
    int marks = briefing_waits | trade_waits << 1 | low << 2 | offline << 3 | (charge + 1) << 4;
    if (lit && face_get_mode() != FACE_DARK) {
        face_set_mode(FACE_ASLEEP);
        vTaskDelay(pdMS_TO_TICKS(FACE_GOODNIGHT_MS));
    }
    if (lit || marks != drawn) {
        light(FACE_DARK);
        face_set_marks(briefing_waits, trade_waits, low, offline, charge);
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
    offline = !net_wait(NET_ALL_MS);
    if (!offline) {
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
    journaled = true;
    int left = gladys_journal();
    if (left >= 0) trade_waits = left > 0;
    else offline = !net_wait(0);
}

// Her door out of reach because the network is: back to the lock screen,
// where the no-internet mark says why.
static void sleep_if_offline(int status) {
    if (status < 0 && !net_wait(0)) {
        offline = true;
        sleep_now();
    }
}

// One exchange with Eugenia: true when she answered.
static bool exchange(void) {
    int status = talk();
    sleep_if_offline(status);
    return status == 200;
}

/* Awake and idle, until PWR: true when it is pressed, false when it is time
   to sleep — put down DOWN_READS readings running, or AWAKE_MS without a
   press, counted from the last time she was held up to look. */
static bool await_press(void) {
    TickType_t looked = xTaskGetTickCount();
    int down = 0;
    for (;;) {
        if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(LOOK_MS))) return true;
        lift_hold_t hold = motion_hold();
        if (hold == LIFT_HELD) looked = xTaskGetTickCount();
        down = hold == LIFT_DOWN ? down + 1 : 0;
        if (down == DOWN_READS || xTaskGetTickCount() - looked >= pdMS_TO_TICKS(AWAKE_MS)) return false;
    }
}

/* Whether she lies put down now: DOWN_READS readings running, LOOK_MS apart,
   as await_press takes them. The first only refreshes the reading they are
   judged against, which is otherwise from before she spoke. */
static bool lying_down(void) {
    motion_hold();
    for (int i = 0; i < DOWN_READS; i++) {
        vTaskDelay(pdMS_TO_TICKS(LOOK_MS));
        if (motion_hold() != LIFT_DOWN) return false;
    }
    return true;
}

static void awake(void) {
    // Joining runs beside everything else: she listens while it does, and
    // waits for it only to send. Offline when she last looked, nothing lights
    // unless it answers now.
    net_start();
    if (offline && !net_wait(OFFLINE_TRY_MS)) sleep_now();
    offline = false;

    // PWR woke her: he wants to talk, so she listens before anything that
    // waits. Otherwise a trade waiting keeps the screen dark until its
    // questions cover it.
    bool pressed = woke == ESP_SLEEP_WAKEUP_EXT0, trade = trade_waits && !pressed;
    light(trade ? FACE_DARK : FACE_IDLE);
    bsp_display_lock(-1);
    lv_obj_t *screen = lv_screen_active();
    static const lv_event_code_t codes[] = { LV_EVENT_PRESSED, LV_EVENT_PRESSING, LV_EVENT_RELEASED };
    for (size_t i = 0; i < sizeof codes / sizeof *codes; i++) lv_obj_add_event_cb(screen, on_touch, codes[i], NULL);
    bsp_display_unlock();

    sound_start();
    sound_volume(cfg.volume);
    if (esp_reset_reason() == ESP_RST_POWERON) sound_chime();  // switched on, not woken or restarted

    // What waits goes first: the journal, then the briefing, which brings her
    // face up from the dark the journal left.
    if (trade) {
        journal();
        if (!briefing_waits) sleep_now();
    }
    bool spoke = pressed && exchange();

    for (;;) {
        if (briefing_waits) {
            briefing_waits = false;
            int status = talk_briefing();
            sleep_if_offline(status);
            spoke |= status == 200;
        }
        // A trade waiting once she is done — one that came in while she spoke,
        // or one PWR put off — gets its questions then, and only then, so
        // nothing interrupts her; once a waking, so walking away from it
        // holds. Put down, nobody is looking at the screen: the trade waits
        // under its mark for the next lift.
        if (spoke && !journaled && (trade_came() || trade_waits)) {
            if (!lying_down()) journal();
            sleep_now();
        }
        if (!await_press()) sleep_now();
        spoke = exchange();
    }
}

static void life(void *arg) {
    (void)arg;
    power_start(xTaskGetCurrentTaskHandle());
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
    xTaskCreatePinnedToCore(life, "life", 12288, NULL, 5, NULL, 0);
}
