/* The board's AXP2101, on the shared I2C bus at 0x34. It switches the board
   on at a press of PWR and off at a long hold; it reports a long press after a
   shorter hold, which is read here every POLL_MS so the charm can close her
   eyes first and switch itself off. Asleep, the chip is not listening: the
   hold then runs on to the power chip's own switch-off, ten seconds.

   The registers are those of Waveshare's own AXP2101 example for this board
   (axp2101_registers.h) and the chip's datasheet. */
#include "power.h"

#include "bsp/esp-bsp.h"
#include "driver/i2c_master.h"
#include "esp_log.h"
#include "face.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "power";

#define ADDRESS      0x34
#define STATUS1      0x00  // bit 5: a cable's power is good; bit 3: a battery is connected
#define COMMON       0x10  // bit 0: switch off
#define KEY_TIMES    0x27  // 5:4 how long a long press is, 3:2 how long switches off
#define IRQ_ENABLE2  0x41
#define IRQ_STATUS2  0x49  // bit 2: PWR held long
#define BATTERY      0xA4  // percent

#define LONG_PRESS   (1 << 2)
#define LONG_1_5S    (1 << 4)
#define OFF_10S      (3 << 2)

#define POLL_MS      200
#define LOW_PERCENT  15
#define GOODNIGHT_MS 1200

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
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(POLL_MS));
        if (!(get(IRQ_STATUS2) & LONG_PRESS)) continue;
        set(IRQ_STATUS2, LONG_PRESS);
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

    // A long press at a second and a half, well before the chip's own
    // switch-off, which goes to its longest so the goodnight always comes first.
    set(KEY_TIMES, (get(KEY_TIMES) & 0x03) | LONG_1_5S | OFF_10S);
    set(IRQ_STATUS2, LONG_PRESS);
    set(IRQ_ENABLE2, get(IRQ_ENABLE2) | LONG_PRESS);
    xTaskCreate(watch, "power", 3072, NULL, 3, NULL);
}

bool power_low(void) {
    uint8_t status = get(STATUS1);
    return (status & (1 << 3)) && !(status & (1 << 5)) && get(BATTERY) <= LOW_PERCENT;
}

int power_charge(void) {
    return get(STATUS1) & (1 << 5) ? get(BATTERY) : -1;
}
