/* The board's QMI8658, on the shared I2C bus at 0x6B, its first interrupt on
   GPIO21 (Waveshare's schematic for the 1.75C).

   Its wake-on-motion holds the interrupt at a level until the acceleration
   moves past a threshold, then flips it, so it is armed again before every
   sleep with the level high and the chip woken by its fall. Looking is two
   ordinary readings after the wake, judged by lift.c.

   Awake, a task of its own follows her for her face: which way is up, for
   the bubbles in her glass, and a jolt, which wobbles it. It reaches the
   screen only through face.c's setters, and is stopped as she is armed.

   The registers and the wake-on-motion sequence are the chip's datasheet's,
   and are among what to check on the real board first. */
#include "motion.h"

#include <string.h>
#include "bsp/esp-bsp.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "face.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lift.h"

static const char *TAG = "motion";

#define ADDRESS     0x6B
#define CTRL1       0x02  // bit 6 auto-increment, bit 3 INT1 out
#define CTRL2       0x03  // accelerometer: bits 6:4 range, 3:0 rate
#define CTRL7       0x08  // bit 0 accelerometer on
#define CTRL9       0x0A  // commands
#define CAL1_L      0x0B  // wake-on-motion threshold, in mg
#define CAL1_H      0x0C  // bits 7:6 which pin and its level before, 5:0 samples ignored at start
#define STATUSINT   0x2D  // bit 7 a command done
#define AX_L        0x35

#define ON_INT1_HIGH (3 << 6)
#define WOM_SETTING 0x08
#define ACK         0x00
#define RANGE_2G    0x00
#define RATE_LOW    0x0D  // 21 Hz, low power, for wake-on-motion
#define RATE_READ   0x06  // 125 Hz, for the two readings

// Readings, not facts: how hard a movement wakes her, and the gap between the
// two readings that judge it.
#define THRESHOLD_MG 120
#define BLANK        8
#define APART_MS     150
#define SAMPLES      8     // averaged into one reading, so the sensor's noise is not a hand's tremor
#define SAMPLE_MS    8     // a new sample at RATE_READ's 125 Hz
#define FOLLOW_MS    40    // how often her face is told how she is held

static i2c_master_dev_handle_t chip;
static bool reading;
static volatile bool following;

static void set(uint8_t reg, uint8_t v) {
    uint8_t out[2] = { reg, v };
    if (i2c_master_transmit(chip, out, 2, 100) != ESP_OK) ESP_LOGW(TAG, "write 0x%02x failed", reg);
}

static void attach(void) {
    if (chip) return;
    i2c_device_config_t dev = { .dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = ADDRESS, .scl_speed_hz = 400000 };
    i2c_master_bus_add_device(bsp_i2c_get_handle(), &dev, &chip);
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

void motion_arm(void) {
    attach();
    following = false;
    reading = false;
    set(CTRL7, 0);
    set(CTRL1, 0x40 | 0x08);
    set(CTRL2, RANGE_2G | RATE_LOW);
    set(CAL1_L, THRESHOLD_MG);
    set(CAL1_H, ON_INT1_HIGH | BLANK);
    command(WOM_SETTING);
    set(CTRL7, 1);
}

static void read_g(float g[3]) {
    uint8_t reg = AX_L, raw[6] = { 0 };
    i2c_master_transmit_receive(chip, &reg, 1, raw, 6, 100);
    for (int i = 0; i < 3; i++) g[i] = (int16_t)(raw[2 * i] | raw[2 * i + 1] << 8) / 16384.0f;
}

// Wake-on-motion off — a threshold of zero — and ordinary readings on.
static void start_reading(void) {
    if (reading) return;
    attach();
    set(CAL1_L, 0);
    command(WOM_SETTING);
    set(CTRL2, RANGE_2G | RATE_READ);
    set(CTRL7, 1);
    vTaskDelay(pdMS_TO_TICKS(30));
    reading = true;
}

bool motion_looked(void) {
    start_reading();
    float first[3], second[3];
    read_g(first);
    vTaskDelay(pdMS_TO_TICKS(APART_MS));
    read_g(second);
    bool looked = lift_seen(first, second);
    ESP_LOGI(TAG, "lift %s: %.2f %.2f %.2f", looked ? "seen" : "not him", second[0], second[1], second[2]);
    return looked;
}

lift_hold_t motion_hold(void) {
    static float before[3];
    static bool judged;
    start_reading();
    float now[3] = { 0 }, g[3];
    for (int s = 0; s < SAMPLES; s++) {
        read_g(g);
        for (int i = 0; i < 3; i++) now[i] += g[i] / SAMPLES;
        vTaskDelay(pdMS_TO_TICKS(SAMPLE_MS));
    }
    lift_hold_t hold = judged ? lift_hold(before, now) : LIFT_ELSE;
    memcpy(before, now, sizeof now);
    judged = true;
    return hold;
}

static void follow(void *arg) {
    (void)arg;
    float before[3], now[3], up[2];
    read_g(before);
    while (following) {
        vTaskDelay(pdMS_TO_TICKS(FOLLOW_MS));
        read_g(now);
        lift_up(now, up);
        face_set_tilt(up[0], up[1]);
        float jolt = lift_jolt(before, now);
        if (jolt > 0) face_jolt(jolt);
        memcpy(before, now, sizeof now);
    }
    vTaskDelete(NULL);
}

void motion_follow(void) {
    if (following) return;
    start_reading();
    following = true;
    xTaskCreate(follow, "follow", 3072, NULL, 2, NULL);
}
