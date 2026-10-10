#include "sleep.h"

#include "bsp/esp-bsp.h"
#include "driver/gpio.h"
#include "driver/rtc_io.h"
#include "esp_sleep.h"

// The BOOT button and the touch controller's interrupt: both pull low.
static const gpio_num_t WAKE[] = { GPIO_NUM_0, BSP_LCD_TOUCH_INT };

/* What would reset or select the panel, or reset the touch controller, if it
   floated. Held through sleep and through an errand that never starts the
   screen, so the picture stays and a tap can still wake her. */
static const gpio_num_t HELD[] = { BSP_LCD_RST, BSP_LCD_CS, BSP_LCD_TOUCH_RST };

#define COUNT(a) (sizeof a / sizeof *a)

void sleep_release(void) {
    for (size_t i = 0; i < COUNT(HELD); i++) gpio_hold_dis(HELD[i]);
    gpio_deep_sleep_hold_dis();
}

void sleep_until(time_t wake_at) {
    for (size_t i = 0; i < COUNT(HELD); i++) gpio_hold_en(HELD[i]);
    gpio_deep_sleep_hold_en();

    uint64_t mask = 0;
    for (size_t i = 0; i < COUNT(WAKE); i++) {
        rtc_gpio_pullup_en(WAKE[i]);
        rtc_gpio_pulldown_dis(WAKE[i]);
        mask |= 1ULL << WAKE[i];
    }
    // The pull-ups hold only while the RTC peripherals keep their power.
    esp_sleep_pd_config(ESP_PD_DOMAIN_RTC_PERIPH, ESP_PD_OPTION_ON);
    esp_sleep_enable_ext1_wakeup_io(mask, ESP_EXT1_WAKEUP_ANY_LOW);

    time_t now = time(NULL);
    if (wake_at > now) esp_sleep_enable_timer_wakeup((uint64_t)(wake_at - now) * 1000000ULL);
    esp_deep_sleep_start();
}
