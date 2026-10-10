/* The board's AXP2101, on the shared I2C bus at 0x34, and the two buttons.

   PWR is the power chip's: a press switches the board on, and a long hold
   switches it off. It also reaches the chip through a transistor as SYS_OUT
   on GPIO3, high while pressed (Waveshare's schematic for the 1.75C), so the
   charm times the hold itself, asleep or awake — a press wakes her — and at a
   second and a half closes her eyes and switches the board off through the
   power chip. The chip's own switch-off is set to its longest, ten seconds,
   so the goodnight always comes first. BOOT pulls GPIO0 low while pressed;
   held five seconds, it opens the setup.

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

#define PWR           GPIO_NUM_3
#define BOOT          GPIO_NUM_0
#define POLL_MS       50
#define OFF_HOLD_MS   1500
#define SETUP_HOLD_MS 5000
#define LOW_PERCENT   15
#define GOODNIGHT_MS  1200

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
    (void)arg;
    int pwr_held = 0, boot_held = 0;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
        pwr_held = gpio_get_level(PWR) ? pwr_held + POLL_MS : 0;
        boot_held = gpio_get_level(BOOT) ? 0 : boot_held + POLL_MS;
        if (boot_held >= SETUP_HOLD_MS) {
            config_ask_setup();
            esp_restart();
        }
        if (pwr_held < OFF_HOLD_MS) continue;
        ESP_LOGI(TAG, "goodnight");
        face_set_mode(FACE_ASLEEP);
        vTaskDelay(pdMS_TO_TICKS(GOODNIGHT_MS));
        face_set_mode(FACE_DARK);
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
        set(COMMON, get(COMMON) | 1);
    }
}

void power_start(void) {
    bsp_i2c_init();
    i2c_device_config_t dev = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = ADDRESS,
        .scl_speed_hz = 400000,
    };
    i2c_master_bus_add_device(bsp_i2c_get_handle(), &dev, &chip);
    set(KEY_TIMES, (get(KEY_TIMES) & ~(3 << 2)) | OFF_10S);
    gpio_config_t buttons = { .pin_bit_mask = 1ULL << PWR | 1ULL << BOOT, .mode = GPIO_MODE_INPUT };
    gpio_config(&buttons);
    xTaskCreate(watch, "power", 3072, NULL, 3, NULL);
}

bool power_low(void) {
    uint8_t status = get(STATUS1);
    return (status & (1 << 3)) && !(status & (1 << 5)) && get(BATTERY) <= LOW_PERCENT;
}

int power_charge(void) {
    return get(STATUS1) & (1 << 5) ? get(BATTERY) : -1;
}
