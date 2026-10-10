#include "net.h"

#include <string.h>
#include <time.h>
#include "config.h"
#include "esp_attr.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

static const char *TAG = "net";

#define JOINED  BIT0
#define REFUSED BIT1
#define GAVE_UP BIT2
#define JOIN_MS 10000
#define FAST_MS 4000   // the network she was last on, asked directly

// New York, clock changes included: the briefing is at 08:00 there all year.
#define NEW_YORK "EST5EDT,M3.2.0,M11.1.0"

// The network she was last on, its access point and channel; kept through sleep.
static RTC_DATA_ATTR struct { char ssid[33]; uint8_t bssid[6]; uint8_t channel; } last;

static EventGroupHandle_t events;

static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg; (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) xEventGroupSetBits(events, REFUSED);
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) xEventGroupSetBits(events, JOINED);
}

// One attempt at one network; `fast` names its access point and channel.
static bool attempt(const charm_net_t *net, bool fast) {
    wifi_config_t sta = { 0 };
    memcpy(sta.sta.ssid, net->ssid, strlen(net->ssid));
    memcpy(sta.sta.password, net->pass, strlen(net->pass));
    if (fast) {
        memcpy(sta.sta.bssid, last.bssid, 6);
        sta.sta.bssid_set = true;
        sta.sta.channel = last.channel;
    }
    esp_wifi_set_config(WIFI_IF_STA, &sta);
    xEventGroupClearBits(events, JOINED | REFUSED);
    esp_wifi_connect();
    EventBits_t got = xEventGroupWaitBits(events, JOINED | REFUSED, pdFALSE, pdFALSE,
                                          pdMS_TO_TICKS(fast ? FAST_MS : JOIN_MS));
    if (got & JOINED) return true;
    esp_wifi_disconnect();
    return false;
}

static void join(void *arg) {
    (void)arg;
    bool joined = false;
    for (int i = 0; i < cfg.n_nets && !joined; i++) {
        if (!strcmp(cfg.nets[i].ssid, last.ssid)) joined = attempt(&cfg.nets[i], true);
    }
    for (int i = 0; i < cfg.n_nets && !joined; i++) {
        joined = attempt(&cfg.nets[i], false);
        if (!joined) ESP_LOGW(TAG, "%s did not answer", cfg.nets[i].ssid);
    }
    if (!joined) {
        last.ssid[0] = 0;
        xEventGroupSetBits(events, GAVE_UP);
        vTaskDelete(NULL);
    }
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        memcpy(last.ssid, ap.ssid, sizeof last.ssid);
        memcpy(last.bssid, ap.bssid, 6);
        last.channel = ap.primary;
        ESP_LOGI(TAG, "joined %s", last.ssid);
    }
    esp_sntp_config_t sntp = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    esp_netif_sntp_init(&sntp);
    vTaskDelete(NULL);
}

void net_start(void) {
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
    // The clock itself survives sleep; the zone it is read in does not.
    setenv("TZ", NEW_YORK, 1);
    tzset();
    xTaskCreate(join, "join", 4096, NULL, 4, NULL);
}

bool net_wait(int ms) {
    return xEventGroupWaitBits(events, JOINED | GAVE_UP, pdFALSE, pdFALSE, pdMS_TO_TICKS(ms)) & JOINED;
}
