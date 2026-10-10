#include "sleep.h"

#include "bsp/esp-bsp.h"
#include "driver/gpio.h"
#include "driver/rtc_io.h"
#include "esp_sleep.h"
#include "power.h"

// The BOOT button and the touch controller's interrupt pull low, as the
// motion sensor's does once it is armed.
static const gpio_num_t WAKE[] = { BOOT_PIN, BSP_LCD_TOUCH_INT, MOTION_PIN };

/* What would reset or select the panel, or reset the touch controller, if it
   floated. Held through sleep and through an errand that never starts the
   screen, so the picture stays and a tap can still wake her. */
static const gpio_num_t HELD[] = { BSP_LCD_RST, BSP_LCD_CS, BSP_LCD_TOUCH_RST };

#define COUNT(a) (sizeof a / sizeof *a)

void sleep_release(void) {
    for (size_t i = 0; i < COUNT(HELD); i++) gpio_hold_dis(HELD[i]);
    gpio_deep_sleep_hold_dis();
}

void sleep_woke(void) {
    rtc_gpio_deinit(PWR_PIN);
    for (size_t i = 0; i < COUNT(WAKE); i++) rtc_gpio_deinit(WAKE[i]);
}

void sleep_until(time_t wake_at, bool motion) {
    for (size_t i = 0; i < COUNT(HELD); i++) gpio_hold_en(HELD[i]);
    gpio_deep_sleep_hold_en();

    uint64_t mask = 0;
    for (size_t i = 0; i < COUNT(WAKE); i++) {
        if (WAKE[i] == MOTION_PIN && !motion) continue;
        rtc_gpio_pullup_en(WAKE[i]);
        rtc_gpio_pulldown_dis(WAKE[i]);
        mask |= 1ULL << WAKE[i];
    }
    // The pulls hold only while the RTC peripherals keep their power.
    esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON);
    esp_sleep_enable_ext1_wakeup_io(mask, ESP_EXT1_WAKEUP_ANY_LOW);
    // PWR, high while pressed, on the one wake input that takes a single pin
    // at either level.
    rtc_gpio_pullup_dis(PWR_PIN);
    rtc_gpio_pulldown_dis(PWR_PIN);
    esp_sleep_enable_ext0_wakeup(PWR_PIN, 1);

    time_t now = time(NULL);
    if (wake_at > now) esp_sleep_enable_timer_wakeup((uint64_t)(wake_at - now) * 1000000ULL);
    esp_deep_sleep_start();
}
