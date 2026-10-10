#include "config.h"

#include <string.h>
#include "nvs.h"
#include "nvs_flash.h"

#define NS "charm"

charm_config_t cfg;

void config_load(void) {
    memset(&cfg, 0, sizeof cfg);
    cfg.brightness = 75;
    cfg.check_min = 5;

    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return;

    char who[16] = "";
    size_t len = sizeof who;
    nvs_get_str(h, "who", who, &len);
    cfg.gladys = strcmp(who, "gladys") == 0;

    len = sizeof cfg.key;
    nvs_get_str(h, "key", cfg.key, &len);

    len = sizeof cfg.nets;
    if (nvs_get_blob(h, "nets", cfg.nets, &len) == ESP_OK) {
        for (int i = 0; i < MAX_NETS && cfg.nets[i].ssid[0]; i++) cfg.n_nets = i + 1;
    }

    int32_t v;
    if (nvs_get_i32(h, "bright", &v) == ESP_OK && v >= 10 && v <= 100) cfg.brightness = v;
    if (nvs_get_i32(h, "check", &v) == ESP_OK && v >= 1 && v <= 60) cfg.check_min = v;
    nvs_close(h);
}

void config_save(void) {
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_str(h, "who", cfg.gladys ? "gladys" : "eugenia");
    nvs_set_str(h, "key", cfg.key);
    nvs_set_blob(h, "nets", cfg.nets, sizeof cfg.nets);
    nvs_set_i32(h, "bright", cfg.brightness);
    nvs_set_i32(h, "check", cfg.check_min);
    nvs_commit(h);
    nvs_close(h);
}

bool config_ready(void) {
    return cfg.n_nets > 0 && cfg.key[0];
}

void config_ask_setup(void) {
    nvs_handle_t h;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
    nvs_set_u8(h, "setup", 1);
    nvs_commit(h);
    nvs_close(h);
}

bool config_take_setup_request(void) {
    nvs_handle_t h;
    uint8_t asked = 0;
    if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
    nvs_get_u8(h, "setup", &asked);
    if (asked) {
        nvs_erase_key(h, "setup");
        nvs_commit(h);
    }
    nvs_close(h);
    return asked;
}
