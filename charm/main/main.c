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
   standby, the press that wakes her has her listening before anything else.
   The conversation comes first: a trade that waits, or comes in while they
   talk, is kept for when it is over — never put between her words, nor
   before a waiting briefing, which is read after her answer however she is
   held. Between turns she feels about once a second whether she is held up
   to look, which keeps her awake, or has been put down, which puts her to
   sleep DOWN_MS later; a finger on the screen counts as held; otherwise
   AWAKE_MS without a press does: her eyes close and she goes to standby.
   Held up and quiet for QUIET_MS, the conversation is over, and a waiting
   trade's questions come up from the dark her eyes close to; put down, she
   sleeps with the trade under its ring. PWR closes the questions for her, the
   trade waiting again. With no internet when she last looked she stays on her
   lock screen, its mark saying why, unless the network answers within
   OFFLINE_TRY_MS; and losing it while they talk sends her back there.

   Standby is light sleep (sleep.c), never a restart: the chip stops where it
   is, the screen started and the sleep screen on it, and wakes into the same
   program, so her face is up the moment she wants it. A tap, PWR and BOOT wake
   her at once; a lift is found at her next check, every POLL_MS, by asking
   the motion sensor whether she has moved (motion.c) and watching a movement
   settle into him looking. One that was not him — a swing, a bump — lights
   nothing and rests the checks for LIFT_REST_S, so a keyring swinging all day
   costs little. Each waking ends in sleep_now(), wherever it is, and life()
   takes the next from standby.

   In standby she wakes on her own every few minutes (errand.c), without
   lighting the screen, to ask Gladys's door what waits, with a soft double
   tick when something new does, and in the briefing's hours (briefing.c)
   Eugenia's whether it has landed; when it has, her face lights and she says
   so. The sleep screen is redrawn only when its marks change. An errand also
   fetches a new app from main, the day Gladys's door names one or at the
   night's look (ota.c), and restarts into it in the dark; a new app proves
   itself before anything else (prove). Each waking he uses reports itself to
   her door as she goes back to standby (report).

   PWR is also the power chip's (power.c): off, a press switches her on, and
   held three seconds she says goodnight and switches off. */
#include "bsp/esp-bsp.h"
#include "bsp/touch.h"
#include "esp_app_desc.h"
#include "esp_attr.h"
#include "esp_flash.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_psram.h"
#include "esp_system.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"
#include <setjmp.h>

#include "briefing.h"
#include "config.h"
#include "dial.h"
#include "errand.h"
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
#define LIFE_STACK    40960  // bytes
#define DRAW_ROWS     12     // drawn at a time, twice over: 22 KB of internal RAM
#define AWAKE_MS      30000
#define PROVE_MS      60000  // a new app's whole proof, the network's wait included
#define LAST_FRAME_MS 200    // the sleep screen's last rows reaching the panel, once rendered
#define POLL_MS       200    // in standby, how often she feels for a lift
#define LIFT_REST_S   20     // her checks' rest after a movement that was not him
#define EARLY_S       5      // how early an errand may come
#define OFFLINE_TRY_MS 8000  // woken offline, how long the network has to answer
#define LOOK_MS       1000   // awake and idle, how often she feels whether she is held
#define DOWN_MS       8000   // put down this long, and nothing playing, she sleeps
#define QUIET_MS      8000   // held up and quiet this long after her last word, the conversation is over

// What waits, whether the internet answered last time and how many errands
// running it has not, what the sleep screen last drew, and when the next
// errand is.
static bool briefing_waits, trade_waits, offline;
static int away, drawn = -1;
static time_t errand_at;

/* What a waking is for, and when it began. Each ends in sleep_now(), which
   jumps back to life() for the next. */
typedef enum { WAKE_START, WAKE_PRESS, WAKE_TOUCH, WAKE_LIFT, WAKE_ERRAND } wake_t;
static wake_t wake;
static int64_t woke_at;
static jmp_buf waking;

/* An update restarts her into its app, which then finishes the errand that
   fetched it, in the dark: marked in the memory a restart does not clear. */
#define UPDATED 0x55504454
static RTC_NOINIT_ATTR uint32_t updated;

static bool lit;

/* The waking's report (report()): when the screen was lit and what internal
   RAM it left, and whether this waking is one worth a report — he woke her,
   or a new app proved itself. The lifts are counted in standby, so the ones
   that were not him, which light nothing and send nothing, are in the next
   report. */
static int64_t lit_at;
static unsigned lit_free, lit_largest;
static bool reporting;
static int lifts_seen, lifts_not;
static volatile uint32_t touches;  // every press and slide on the screen, counted

// A slide round the rim is the volume; a tap on a question is the journal's.
static void on_touch(lv_event_t *e) {
    lv_event_code_t code = lv_event_get_code(e);
    lv_point_t at;
    lv_indev_get_point(lv_indev_active(), &at);
    touches++;
    if (code == LV_EVENT_PRESSED) dial_press(at);
    if (code == LV_EVENT_PRESSING) dial_slide(at);
    if (code == LV_EVENT_RELEASED) dial_lift();
}

// The panel takes its coordinates in pairs, as the board package rounds them.
static void even_area(lv_event_t *e) {
    lv_area_t *a = lv_event_get_param(e);
    a->x1 &= ~1;
    a->y1 &= ~1;
    a->x2 |= 1;
    a->y2 |= 1;
}

/* The screen in `mode`, started at her first waking and kept through every
   standby after. It is the board package's bsp_display_start but for where
   she draws: the package's draws into PSRAM, which the SPI driver will not
   send from, so it copies each draw into an internal buffer as large as the
   draw, 46 KB, which a board running Wi-Fi seldom has free. DRAW_ROWS rows at
   a time in internal RAM are sent as they are. */
static void light(face_mode_t mode) {
    face_set_mode(mode);
    if (!lit) {
        lit = true;
        bsp_display_cfg_t cfg = {
            .lv_adapter_cfg = ESP_LV_ADAPTER_DEFAULT_CONFIG(),
            .touch_flags = { .mirror_x = 1, .mirror_y = 1 },
        };
        const bsp_display_config_t whole = { .max_transfer_sz = BSP_LCD_H_RES * BSP_LCD_V_RES * BSP_LCD_BITS_PER_PIXEL / 8 };
        esp_lcd_panel_handle_t panel;
        esp_lcd_panel_io_handle_t io;
        esp_lcd_touch_handle_t touch;
        ESP_ERROR_CHECK(esp_lv_adapter_init(&cfg.lv_adapter_cfg));
        ESP_ERROR_CHECK(bsp_display_new(&whole, &panel, &io));
        const esp_lv_adapter_display_config_t screen = {
            .panel = panel,
            .panel_io = io,
            .profile = {
                .interface = ESP_LV_ADAPTER_PANEL_IF_OTHER,
                .rotation = ESP_LV_ADAPTER_ROTATE_0,
                .hor_res = BSP_LCD_H_RES,
                .ver_res = BSP_LCD_V_RES,
                .buffer_height = DRAW_ROWS,
                .use_psram = false,
                .require_double_buffer = true,
            },
            .tear_avoid_mode = ESP_LV_ADAPTER_TEAR_AVOID_MODE_NONE,
        };
        lv_display_t *display = esp_lv_adapter_register_display(&screen);
        lv_display_add_event_cb(display, even_area, LV_EVENT_INVALIDATE_AREA, NULL);
        ESP_ERROR_CHECK(bsp_touch_new(&cfg, &touch));
        const esp_lv_adapter_touch_config_t finger = ESP_LV_ADAPTER_TOUCH_DEFAULT_CONFIG(display, touch);
        esp_lv_adapter_register_touch(&finger);
        ESP_ERROR_CHECK(bsp_display_brightness_init());
        ESP_ERROR_CHECK(esp_lv_adapter_start());
        bsp_display_brightness_set(BRIGHTNESS);
        bsp_display_lock(-1);
        face_start();
        bsp_display_unlock();
    }
    // From her waking, beside talk.c's first listening: how much of a press's
    // or a lift's wait is the screen. And what internal RAM the screen and
    // Wi-Fi leave the codecs and TLS, the board's scarcest memory.
    if (lit_at) return;
    lit_at = esp_timer_get_time() - woke_at;
    lit_free = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
    lit_largest = heap_caps_get_largest_free_block(MALLOC_CAP_INTERNAL);
    ESP_LOGI(TAG, "lit, %u bytes of internal RAM free, %u in one piece", lit_free, lit_largest);
}

/* One line for her door to file beside her runs, so a waking on the board is
   read without a cable: the app, what woke her and why the chip last reset,
   the lifts since the last report, when she was lit and first listened in ms
   from her waking, the battery, the internal RAM at lit and at its lowest,
   the signal, and how long she was up. Sent only online and never retried;
   built either way, so neither the lifts nor her listening carry into the
   next waking's line. */
static void report(void) {
    wifi_ap_record_t ap;
    int rssi = esp_wifi_sta_get_ap_info(&ap) == ESP_OK ? ap.rssi : 0;
    int64_t listened = talk_listened();
    char text[256];
    snprintf(text, sizeof text,
             "app=%.8s woke=%d reset=%d lifts=%d/%d lit=%lld listen=%lld battery=%d free=%u largest=%u lowest=%u "
             "rssi=%d up=%lld",
             esp_app_get_description()->version, (int)wake, (int)esp_reset_reason(), lifts_seen, lifts_not,
             lit_at / 1000, listened ? (listened - woke_at) / 1000 : 0, power_battery(), lit_free, lit_largest,
             (unsigned)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL), rssi,
             (esp_timer_get_time() - woke_at) / 1000);
    lifts_seen = lifts_not = 0;
    if (net_wait(0)) talk_report(text);
}

// Her briefing has landed: lit for Eugenia to say so.
static void light_eugenia(void) { light(FACE_THINKING); }

// Her eyes closing, when her face is showing; the journal leaves the dark already up.
static void close_eyes(void) {
    if (lit && face_get_mode() != FACE_DARK) {
        face_set_mode(FACE_ASLEEP);
        vTaskDelay(pdMS_TO_TICKS(FACE_GOODNIGHT_MS));
    }
}

/* Goodnight, her eyes closing, then the sleep screen, drawn only when she
   shows something else or its marks differ from what the panel holds, whole
   before the chip stops; the codecs and the radio off; and back to life(),
   wherever the waking was, for standby to take the next. */
static void sleep_now(void) {
    // Her door reads today's briefing alone: past midnight, yesterday's is gone.
    if (briefing_waits && !briefing_today(time(NULL))) briefing_waits = false;
    int charge = power_charge();
    bool low = power_low();
    int marks = face_marks(briefing_waits, trade_waits, low, offline, charge);
    close_eyes();
    if (!lit || face_get_mode() != FACE_DARK || marks != drawn) {
        light(FACE_DARK);
        face_set_marks(briefing_waits, trade_waits, low, offline, charge);
        bsp_display_lock(-1);
        face_draw_dark();
        bsp_display_unlock();
        vTaskDelay(pdMS_TO_TICKS(LAST_FRAME_MS));
        drawn = marks;
    }
    errand_at = time(NULL) + errand_wait(time(NULL), charge >= 0, trade_waits, away);
    if (reporting) report();
    sound_stop();
    net_stop();
    longjmp(waking, 1);
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
    away = offline ? away + 1 : 0;
    if (!offline) {
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
        // A new app from main — the day Gladys's door names one she has not
        // run or seen fail, or at the night's look in the small hours: she
        // restarts into it at once, quietly, for this errand's place. The
        // battery is asked first, since asking ota_due spends the night's look:
        // one a low battery skips waits for a later errand in the hour, on the
        // cable perhaps.
        if (!power_low() && (ota_offered(gladys_app()) || ota_due(time(NULL))) && ota_update()) {
            updated = UPDATED;
            sound_stop();
            esp_restart();
        }
    }
    sleep_now();
}

/* The journal of what waits; the sleep screen's mark follows what is left.
   True when PWR closed it: he wants her, and the press is taken. */
static bool journal(void) {
    int left = gladys_journal();
    if (left >= 0) trade_waits = left > 0;
    else offline = !net_wait(0);
    return ulTaskNotifyTake(pdTRUE, 0);
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

/* Between turns, how the conversation goes on or ends: PWR, and he talks
   again; with a trade waiting, held up to look and quiet QUIET_MS since she
   finished, and the conversation is over with him looking; put down for
   DOWN_MS since she finished, or AWAKE_MS since she was last held up, and he
   has gone. A finger on the screen is held, and never put down. */
typedef enum { NEXT_TURN, OVER_LOOKING, OVER_AWAY } between_t;

static between_t between_turns(bool trade) {
    TickType_t finished = xTaskGetTickCount(), looked = finished, up = finished;
    uint32_t counted = touches;
    for (;;) {
        if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(LOOK_MS))) return NEXT_TURN;
        lift_hold_t hold = motion_hold();
        TickType_t now = xTaskGetTickCount();
        bool touched = touches != counted;
        counted = touches;
        if (hold == LIFT_HELD || touched) looked = now;
        if (hold != LIFT_DOWN || touched) up = now;
        if (trade && hold == LIFT_HELD && now - finished >= pdMS_TO_TICKS(QUIET_MS)) return OVER_LOOKING;
        if (now - up >= pdMS_TO_TICKS(DOWN_MS) || now - looked >= pdMS_TO_TICKS(AWAKE_MS)) return OVER_AWAY;
    }
}

static void awake(void) {
    reporting = true;
    // Joining runs beside everything else: she listens while it does, and
    // waits for it only to send. Offline when she last looked, nothing lights
    // unless it answers now.
    net_start();
    if (offline && !net_wait(OFFLINE_TRY_MS)) sleep_now();
    offline = false;
    away = 0;

    // PWR woke her: he wants to talk, so she listens before anything that
    // waits. Otherwise a trade waiting keeps the screen dark until its
    // questions cover it.
    bool pressed = wake == WAKE_PRESS, trade = trade_waits && !pressed;
    light(trade ? FACE_DARK : FACE_IDLE);
    // The screen's touch, handed to the dial once: the screen outlives every
    // waking after the first.
    static bool felt;
    if (!felt) {
        felt = true;
        bsp_display_lock(-1);
        lv_obj_t *screen = lv_screen_active();
        static const lv_event_code_t codes[] = { LV_EVENT_PRESSED, LV_EVENT_PRESSING, LV_EVENT_RELEASED };
        for (size_t i = 0; i < sizeof codes / sizeof *codes; i++) lv_obj_add_event_cb(screen, on_touch, codes[i], NULL);
        bsp_display_unlock();
    }

    sound_start();
    sound_volume(cfg.volume);
    // Switched on, not woken from standby or restarted.
    if (wake == WAKE_START && esp_reset_reason() == ESP_RST_POWERON) sound_chime();

    // What waits goes first: the journal, then the briefing, which brings her
    // face up from the dark the journal left. PWR closes the journal and she
    // listens, the briefing after her answer.
    bool listen = pressed;
    if (trade) {
        listen = journal();
        if (!listen && !briefing_waits) sleep_now();
    }
    bool spoke = listen && exchange();

    // A waiting briefing is read once a waking. Read, or none stored for
    // today, its dot goes; a failure leaves it up for the next waking.
    bool brief = briefing_waits;
    for (;;) {
        if (brief) {
            brief = false;
            int status = talk_briefing();
            briefing_waits = status != 200 && status != 204;
            sleep_if_offline(status);
            spoke |= status == 200;
        }
        // Each answer asks what waits, and a trade is kept for when the
        // conversation is over: its questions come up from the dark once he
        // has stopped and is looking, and walking away from them holds — she
        // sleeps after. PWR on them and the conversation goes on, the trade
        // waiting again.
        if (spoke) trade_came();
        between_t next = between_turns(trade_waits);
        if (next == OVER_AWAY) sleep_now();
        if (next == OVER_LOOKING) {
            close_eyes();
            face_set_mode(FACE_DARK);
            if (!journal()) sleep_now();
        }
        spoke = exchange();
    }
}

/* A new app from main is kept only once it has done what a broken one could
   not: started her screen and drawn the sleep screen whole, and reached her
   Wi-Fi. A hang on the way — a screen that never finishes a frame — is caught
   by the task watchdog, armed for this alone to reset her, and any reset
   before ota_confirm has the bootloader start the app that was. Without a
   network it is not kept: she restarts, and the bootloader starts the app
   that was, since standby would otherwise keep an unjudged app for as long as
   nothing reset her. An unproven app does this before anything else, so no
   path sleeps on an app nothing has judged. */
static void prove(void) {
    const esp_task_wdt_config_t strict = { .timeout_ms = PROVE_MS, .idle_core_mask = 0, .trigger_panic = true };
    esp_task_wdt_reconfigure(&strict);
    esp_task_wdt_add(NULL);
    net_start();
    bool joined = net_wait(NET_ALL_MS);
    light(FACE_DARK);
    bsp_display_lock(-1);
    face_draw_dark();
    bsp_display_unlock();
    esp_task_wdt_delete(NULL);
    const esp_task_wdt_config_t usual = { .timeout_ms = CONFIG_ESP_TASK_WDT_TIMEOUT_S * 1000,
                                          .idle_core_mask = (1 << portNUM_PROCESSORS) - 1 };
    esp_task_wdt_reconfigure(&usual);
    ESP_LOGI(TAG, "a new app %s", joined ? "proved and kept" : "drawn, but no network to keep it on");
    if (!joined) esp_restart();
    ota_confirm();
    reporting = true;
}

/* Standby until something wants her: PWR, a tap or BOOT at once, and a press
   she missed while awake for a check; a lift at her next check; the errand
   at its time. Each check is one reading of the motion sensor; one that has
   moved her is watched as it settles (motion_looked), and a movement that was
   not him rests the checks for LIFT_REST_S, so a keyring swinging all day
   costs a check now and then. */
static wake_t standby(void) {
    int64_t rest_until = 0;
    for (;;) {
        if (ulTaskNotifyTake(pdTRUE, 0)) return WAKE_PRESS;
        time_t now = time(NULL);
        if (now + EARLY_S >= errand_at) return WAKE_ERRAND;
        int64_t ms = esp_timer_get_time() / 1000, errand_ms = (int64_t)(errand_at - now) * 1000;
        int64_t nap = ms < rest_until ? rest_until - ms : POLL_MS;
        // LVGL held between frames, so the sleep never stops a touch read
        // halfway on the bus the motion sensor and the power chip share.
        bsp_display_lock(-1);
        slept_t slept = sleep_light(nap < errand_ms ? nap : errand_ms);
        bsp_display_unlock();
        if (slept == SLEPT_PRESS) {
            power_woke();
            return WAKE_PRESS;
        }
        if (slept == SLEPT_TOUCH) return WAKE_TOUCH;
        if (esp_timer_get_time() / 1000 < rest_until || !motion_stirred()) continue;
        if (motion_looked()) {
            lifts_seen++;
            return WAKE_LIFT;
        }
        lifts_not++;
        rest_until = esp_timer_get_time() / 1000 + LIFT_REST_S * 1000;
    }
}

static void life(void *arg) {
    (void)arg;
    power_start(xTaskGetCurrentTaskHandle());
    // A battery too low for her radio resets the chip as its voltage sags,
    // and every waking would only reset it again, the screen and the radio
    // drawing the cell down past where it should stop. Off the cable, the
    // board switches off instead, as the goodnight does. A power chip that
    // cannot be read reads as no cable and no battery alike, so it is a
    // battery seen that makes this off the cable.
    if (esp_reset_reason() == ESP_RST_BROWNOUT && power_battery() >= 0 && power_charge() < 0) power_off();
    if (ota_unproven()) prove();
    wake = updated == UPDATED ? WAKE_ERRAND : WAKE_START;
    updated = 0;
    /* Every waking ends in sleep_now(), however deep in it, as a sleep that
       restarted the chip once ended it; it jumps back here, and standby says
       what the next one is for. */
    if (setjmp(waking)) {
        reporting = false;
        wake = standby();
        woke_at = esp_timer_get_time();
        lit_at = 0;
    }
    if (wake == WAKE_ERRAND) errand();
    else awake();
}

void app_main(void) {
    sleep_let_go();
    config_load();

    // What the board turned out to be, for the first serial log.
    uint32_t flash = 0;
    esp_flash_get_size(NULL, &flash);
    ESP_LOGI(TAG, "flash %lu MB · PSRAM %u MB · reset by %d",
             (unsigned long)(flash >> 20), (unsigned)(esp_psram_get_size() >> 20), (int)esp_reset_reason());

    if (config_take_setup_request() || !config_ready()) {
        light(FACE_DARK);
        setup_run();
    }
    /* The stack holds a TLS handshake, and the Opus encoder, which Espressif's
       codec README puts at about 40 KB. In PSRAM: in internal RAM beside the
       screen and Wi-Fi it leaves the codecs too little for their DMA, and the
       board package aborts as her speaker starts. Her code runs from PSRAM,
       so the cache stays on while she writes her flash, and light sleep,
       which suspends it, is entered from a task of its own (sleep.c). */
    static StaticTask_t task;
    xTaskCreateStaticPinnedToCore(life, "life", LIFE_STACK, NULL, 5,
                                  heap_caps_malloc(LIFE_STACK, MALLOC_CAP_SPIRAM), &task, 0);
}
