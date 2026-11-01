#include "sleep.h"

#include "bsp/esp-bsp.h"
#include "driver/rtc_io.h"
#include "esp_sleep.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "power.h"

// The BOOT button and the touch controller's interrupt pull low.
static const gpio_num_t WAKE[] = { BOOT_PIN, BSP_LCD_TOUCH_INT };

#define COUNT(a) (sizeof a / sizeof *a)
#define STACK    3072

static TaskHandle_t sleeper;
static SemaphoreHandle_t woken;

/* The sleep itself, from a task of its own: light sleep suspends the cache
   that PSRAM is read through, and her task's stack is in PSRAM (main.c). It
   says it has woken through a semaphore, since a notification to her task is
   a press of PWR. */
static void enter(void *arg) {
    (void)arg;
    for (;;) {
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
        esp_light_sleep_start();
        xSemaphoreGive(woken);
    }
}

slept_t sleep_light(int64_t ms) {
    if (!sleeper) {
        static StaticTask_t task;
        static StackType_t stack[STACK];
        static StaticSemaphore_t done;
        woken = xSemaphoreCreateBinaryStatic(&done);
        sleeper = xTaskCreateStaticPinnedToCore(enter, "sleep", STACK, NULL, configMAX_PRIORITIES - 1,
                                                stack, &task, xPortGetCoreID());
    }
    uint64_t mask = 0;
    for (size_t i = 0; i < COUNT(WAKE); i++) {
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
    esp_sleep_enable_timer_wakeup((uint64_t)(ms > 0 ? ms : 1) * 1000);

    xTaskNotifyGive(sleeper);
    xSemaphoreTake(woken, portMAX_DELAY);

    // A pin that can wake her stays with its sleep circuit, reading nothing,
    // until it is given back.
    rtc_gpio_deinit(PWR_PIN);
    for (size_t i = 0; i < COUNT(WAKE); i++) rtc_gpio_deinit(WAKE[i]);
    esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
    return cause == ESP_SLEEP_WAKEUP_EXT0 ? SLEPT_PRESS : cause == ESP_SLEEP_WAKEUP_EXT1 ? SLEPT_TOUCH : SLEPT;
}
