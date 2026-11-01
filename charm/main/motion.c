/* The board's QMI8658, on the shared I2C bus at 0x6B. Its accelerometer is
   started once and left reading, and she asks it: in standby one reading at
   each check, awake a few averaged. Nothing waits on its interrupt: on the
   board, its wake never reached the chip.

   The registers are the chip's datasheet's, and are among what to check on
   the real board first. */
#include "motion.h"

#include <string.h>
#include "bsp/esp-bsp.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lift.h"

static const char *TAG = "motion";

#define ADDRESS     0x6B
#define CTRL1       0x02  // bit 6 auto-increment, bit 5 big-endian
#define CTRL2       0x03  // accelerometer: bits 6:4 range, 3:0 rate
#define CTRL7       0x08  // bit 0 accelerometer on
#define CTRL9       0x0A  // commands
#define CAL1_L      0x0B  // wake-on-motion threshold, in mg
#define STATUSINT   0x2D  // bit 7 a command done
#define AX_L        0x35
#define WOM_SETTING 0x08
#define ACK         0x00

/* Auto-increment and little-endian, as read_g reads six bytes. The chip
   powers up big-endian without auto-increment, which reads one byte six
   times: every axis the same number. */
#define INTERFACE   0x40
#define RANGE_2G    0x00
#define RATE_READ   0x06  // 125 Hz

// Readings, not facts: the gap between the two readings of a pair that judge
// a lift, and how long a lift has to settle into him looking.
#define APART_MS     150
#define LOOK_FOR_MS  1500
#define SAMPLES      8     // averaged into one reading, so the sensor's noise is not a hand's tremor
#define SAMPLE_MS    8     // a new sample at RATE_READ's 125 Hz
#define FRESH_US     2000000  // a reading older than this compares with nothing

static i2c_master_dev_handle_t chip;
static bool reading;

static void set(uint8_t reg, uint8_t v) {
    uint8_t out[2] = { reg, v };
    if (i2c_master_transmit(chip, out, 2, 100) != ESP_OK) ESP_LOGW(TAG, "write 0x%02x failed", reg);
}

// A command through CTRL9: written, waited on, acknowledged.
static void command(uint8_t c) {
    set(CTRL9, c);
    uint8_t reg = STATUSINT, status = 0;
    for (int i = 0; i < 20 && !(status & 0x80); i++) {
        vTaskDelay(pdMS_TO_TICKS(2));
        i2c_master_transmit_receive(chip, &reg, 1, &status, 1, 100);
    }
    set(CTRL9, ACK);
}

/* The chip keeps its settings while the board has power, through a restart
   into a new app, so wake-on-motion is turned off — a threshold of zero —
   whatever set it. */
static void start_reading(void) {
    if (reading) return;
    i2c_device_config_t dev = { .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = ADDRESS, .scl_speed_hz = 400000 };
    i2c_master_bus_add_device(bsp_i2c_get_handle(), &dev, &chip);
    set(CTRL7, 0);
    set(CTRL1, INTERFACE);
    set(CAL1_L, 0);
    command(WOM_SETTING);
    set(CTRL2, RANGE_2G | RATE_READ);
    set(CTRL7, 1);
    vTaskDelay(pdMS_TO_TICKS(30));
    reading = true;
}

static void read_g(float g[3]) {
    start_reading();
    uint8_t reg = AX_L, raw[6] = { 0 };
    i2c_master_transmit_receive(chip, &reg, 1, raw, 6, 100);
    for (int i = 0; i < 3; i++) g[i] = (int16_t)(raw[2 * i] | raw[2 * i + 1] << 8) / 16384.0f;
}

/* A reading kept to judge the next by, and when it was taken: one taken long
   enough ago says nothing about the movement since. */
typedef struct { float g[3]; int64_t at; } kept_t;

static bool fresh(kept_t *k, const float now[3]) {
    int64_t t = esp_timer_get_time();
    bool judged = k->at && t - k->at < FRESH_US;
    memcpy(k->g, now, sizeof k->g);
    k->at = t;
    return judged;
}

bool motion_stirred(void) {
    static kept_t last;
    float now[3], before[3];
    read_g(now);
    memcpy(before, last.g, sizeof before);
    return fresh(&last, now) && lift_stirred(before, now);
}

/* A lift is caught as it starts, still moving, so its first instant says
   little: she watches it settle, a pair of readings at a time, for up to
   LOOK_FOR_MS, and is lit the moment one pair is him looking. */
bool motion_looked(void) {
    float before[3], now[3];
    read_g(before);
    for (int waited = 0; waited < LOOK_FOR_MS; waited += APART_MS) {
        vTaskDelay(pdMS_TO_TICKS(APART_MS));
        read_g(now);
        if (lift_seen(before, now)) {
            ESP_LOGI(TAG, "lift seen after %d ms: %.2f %.2f %.2f", waited + APART_MS, now[0], now[1], now[2]);
            return true;
        }
        memcpy(before, now, sizeof now);
    }
    ESP_LOGI(TAG, "lift not him: %.2f %.2f %.2f", now[0], now[1], now[2]);
    return false;
}

lift_hold_t motion_hold(void) {
    static kept_t last;
    float now[3] = { 0 }, g[3], before[3];
    for (int s = 0; s < SAMPLES; s++) {
        read_g(g);
        for (int i = 0; i < 3; i++) now[i] += g[i] / SAMPLES;
        vTaskDelay(pdMS_TO_TICKS(SAMPLE_MS));
    }
    memcpy(before, last.g, sizeof before);
    lift_hold_t hold = fresh(&last, now) ? lift_hold(before, now) : LIFT_ELSE;
    // Said when it changes, with the reading, so the board says how it is judged.
    static lift_hold_t said = LIFT_ELSE;
    if (hold != said) {
        static const char *const HOLDS[] = { "neither", "held", "down" };
        ESP_LOGI(TAG, "%s: %.2f %.2f %.2f", HOLDS[hold], now[0], now[1], now[2]);
        said = hold;
    }
    return hold;
}
