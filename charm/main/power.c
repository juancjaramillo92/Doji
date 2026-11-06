/* The board's AXP2101, on the shared I2C bus at 0x34, and the two buttons.

   PWR is the power chip's: a press switches the board on, and a long hold
   switches it off. It also reaches the chip through a transistor as SYS_OUT
   on GPIO3, high while pressed (Waveshare's schematic for the 1.75C), so the
   charm reads it too: a press wakes her, a short one is the talk button, and
   at three seconds she closes her eyes and switches the board off through the
   power chip. The chip's own switch-off is set to its longest, ten seconds,
   so the goodnight always comes first, and stays the way out of a hung
   charm. BOOT pulls GPIO0 low while pressed; held five seconds, it opens the
   setup. BOOT is not the talk button: the chip reads it at start to choose
   its programming mode, and a press at the wrong moment would choose it.

   The registers are those of Waveshare's own AXP2101 example for this board
   (axp2101_registers.h) and the chip's datasheet. */
#include "power.h"

#include "bsp/esp-bsp.h"
#include "config.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "esp_system.h"
#include "face.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "power";

#define ADDRESS      0x34
#define STATUS1      0x00  // bit 5: a cable's power is good; bit 3: a battery is connected
#define COMMON       0x10  // bit 0: switch off
#define KEY_TIMES    0x27  // bits 3:2, how long a hold switches the board off
#define BATTERY      0xA4  // percent
#define OFF_10S      (3 << 2)

#define POLL_MS       50
#define TAP_MS        600    // shorter than this, a press is the talk button
#define OFF_HOLD_MS   3000
#define SETUP_HOLD_MS 5000
#define LOW_PERCENT   15

static i2c_master_dev_handle_t chip;

static uint8_t get(uint8_t reg) {
    uint8_t v = 0;
    if (i2c_master_transmit_receive(chip, &reg, 1, &v, 1, 100) != ESP_OK) ESP_LOGW(TAG, "read 0x%02x failed", reg);
    return v;
}

static void set(uint8_t reg, uint8_t v) {
    uint8_t out[2] = { reg, v };
    if (i2c_master_transmit(chip, out, 2, 100) != ESP_OK) ESP_LOGW(TAG, "write 0x%02x failed", reg);
}

static void watch(void *arg) {
    TaskHandle_t talker = arg;
    // The press that woke her is answered by main.c, which listens at once;
    // only its hold still counts, toward switching off.
    bool waking = gpio_get_level(PWR_PIN);
    int pwr_held = 0, boot_held = 0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
        if (gpio_get_level(PWR_PIN)) {
            pwr_held += POLL_MS;
        } else {
            if (pwr_held && pwr_held < TAP_MS && !waking) xTaskNotifyGive(talker);
            pwr_held = 0;
            waking = false;
        }
        face_set_hold(pwr_held > TAP_MS ? (float)(pwr_held - TAP_MS) / (OFF_HOLD_MS - TAP_MS) : 0);
        boot_held = gpio_get_level(BOOT_PIN) ? 0 : boot_held + POLL_MS;
        if (boot_held >= SETUP_HOLD_MS) {
            config_ask_setup();
            esp_restart();
        }
        if (pwr_held < OFF_HOLD_MS) continue;
        ESP_LOGI(TAG, "goodnight");
        face_set_mode(FACE_ASLEEP);
        vTaskDelay(pdMS_TO_TICKS(FACE_GOODNIGHT_MS));
        face_set_mode(FACE_DARK);
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
        power_off();
    }
}

void power_start(TaskHandle_t talker) {
    bsp_i2c_init();
    i2c_device_config_t dev = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = ADDRESS,
        .scl_speed_hz = 400000,
    };
    i2c_master_bus_add_device(bsp_i2c_get_handle(), &dev, &chip);
    set(KEY_TIMES, (get(KEY_TIMES) & ~(3 << 2)) | OFF_10S);
    gpio_config_t buttons = { .pin_bit_mask = 1ULL << PWR_PIN | 1ULL << BOOT_PIN, .mode = GPIO_MODE_INPUT };
    gpio_config(&buttons);
    xTaskCreate(watch, "power", 3072, talker, 3, NULL);
}

void power_off(void) {
    set(COMMON, get(COMMON) | 1);
}

bool power_low(void) {
    uint8_t status = get(STATUS1);
    return (status & (1 << 3)) && !(status & (1 << 5)) && get(BATTERY) <= LOW_PERCENT;
}

int power_charge(void) {
    return get(STATUS1) & (1 << 5) ? get(BATTERY) : -1;
}

int power_battery(void) {
    return get(STATUS1) & (1 << 3) ? get(BATTERY) : -1;
}
