#include "net.h"

#include <string.h>
#include <time.h>
#include "config.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

static const char *TAG = "net";

#define JOINED  BIT0
#define REFUSED BIT1
#define JOIN_MS 10000

// New York, clock changes included: the briefing is at 08:00 there all year.
#define NEW_YORK "EST5EDT,M3.2.0,M11.1.0"

static EventGroupHandle_t events;

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg; (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) xEventGroupSetBits(events, REFUSED);
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) xEventGroupSetBits(events, JOINED);
}

bool net_start(void) {
    events = xEventGroupCreate();
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&init);
    esp_event_handler_register(WIFI_EVENT, WIFI_EVENT_STA_DISCONNECTED, on_event, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL);
    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_start();

    for (int i = 0; i < cfg.n_nets; i++) {
        // The driver's fields need no terminator: a name may fill all 32 bytes.
        wifi_config_t sta = { 0 };
        memcpy(sta.sta.ssid, cfg.nets[i].ssid, strlen(cfg.nets[i].ssid));
        memcpy(sta.sta.password, cfg.nets[i].pass, strlen(cfg.nets[i].pass));
        esp_wifi_set_config(WIFI_IF_STA, &sta);
        xEventGroupClearBits(events, JOINED | REFUSED);
        esp_wifi_connect();
        EventBits_t got = xEventGroupWaitBits(events, JOINED | REFUSED, pdFALSE, pdFALSE,
                                              pdMS_TO_TICKS(JOIN_MS));
        if (got & JOINED) {
            ESP_LOGI(TAG, "joined %s", cfg.nets[i].ssid);
            setenv("TZ", NEW_YORK, 1);
            tzset();
            esp_sntp_config_t sntp = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
            esp_netif_sntp_init(&sntp);
            if (esp_netif_sntp_sync_wait(pdMS_TO_TICKS(10000)) == ESP_OK) {
                time_t now = time(NULL);
                char at[32];
                strftime(at, sizeof at, "%a %H:%M", localtime(&now));
                ESP_LOGI(TAG, "New York time %s", at);
            }
            return true;
        }
        esp_wifi_disconnect();
        ESP_LOGW(TAG, "%s did not answer", cfg.nets[i].ssid);
    }
    return false;
}
