#include "setup.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bsp/esp-bsp.h"
#include "config.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "lwip/sockets.h"

static const char *TAG = "setup";

#define PAGE_MAX  9000
#define BODY_MAX  2048
#define SEEN_MAX  12

static char ap_name[24];
static wifi_ap_record_t seen[SEEN_MAX];
static uint16_t n_seen;

/* ─── The screen ──────────────────────────────────────────────────────── */

static void show_screen(void) {
    bsp_display_lock(-1);
    lv_obj_t *veil = lv_obj_create(lv_screen_active());
    lv_obj_remove_style_all(veil);
    lv_obj_set_size(veil, 466, 466);
    lv_obj_set_style_bg_color(veil, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(veil, LV_OPA_80, 0);

    lv_obj_t *title = lv_label_create(veil);
    lv_label_set_text(title, "Set me up");
    lv_obj_set_style_text_color(title, lv_color_hex(0xe8e6f0), 0);
    lv_obj_set_style_text_font(title, &lv_font_montserrat_24, 0);
    lv_obj_align(title, LV_ALIGN_CENTER, 0, -40);

    lv_obj_t *how = lv_label_create(veil);
    lv_label_set_text_fmt(how, "On your phone, join\n%s", ap_name);
    lv_obj_set_style_text_align(how, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_style_text_color(how, lv_color_hex(0x9a92b0), 0);
    lv_obj_set_style_text_font(how, &lv_font_montserrat_16, 0);
    lv_obj_align(how, LV_ALIGN_CENTER, 0, 24);
    bsp_display_unlock();
}

/* ─── The network and the answer to every name ────────────────────────────
   A phone that joins checks a well-known address to see whether it is online;
   answering every DNS question with the charm itself, and redirecting every
   page but ours to it, is what makes the phone open the page on its own. */

static void dns_task(void *arg) {
    (void)arg;
    int s = socket(AF_INET, SOCK_DGRAM, 0);
    struct sockaddr_in addr = { .sin_family = AF_INET, .sin_port = htons(53),
                                .sin_addr.s_addr = htonl(INADDR_ANY) };
    bind(s, (struct sockaddr *)&addr, sizeof addr);
    uint8_t buf[512];
    for (;;) {
        struct sockaddr_in from;
        socklen_t fl = sizeof from;
        int n = recvfrom(s, buf, sizeof buf - 16, 0, (struct sockaddr *)&from, &fl);
        if (n < 12) continue;
        // The question stays as asked; one A record answers it with 192.168.4.1.
        buf[2] = 0x81; buf[3] = 0x80;          // a response, recursion available
        buf[6] = 0; buf[7] = 1;                // one answer
        buf[8] = buf[9] = buf[10] = buf[11] = 0;
        static const uint8_t answer[] = { 0xC0, 0x0C, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 168, 4, 1 };
        memcpy(buf + n, answer, sizeof answer);
        sendto(s, buf, n + sizeof answer, 0, (struct sockaddr *)&from, fl);
    }
}

static void start_network(void) {
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_ap();
    esp_netif_create_default_wifi_sta();
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&init);

    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    snprintf(ap_name, sizeof ap_name, "Charm-Setup-%02X%02X", mac[4], mac[5]);

    wifi_config_t ap = { .ap = { .channel = 1, .max_connection = 2, .authmode = WIFI_AUTH_OPEN } };
    strcpy((char *)ap.ap.ssid, ap_name);
    ap.ap.ssid_len = strlen(ap_name);
    esp_wifi_set_mode(WIFI_MODE_APSTA);
    esp_wifi_set_config(WIFI_IF_AP, &ap);
    esp_wifi_start();

    // The networks in range, offered on the page so a name need not be typed.
    if (esp_wifi_scan_start(NULL, true) == ESP_OK) {
        n_seen = SEEN_MAX;
        esp_wifi_scan_get_ap_records(&n_seen, seen);
    }
    xTaskCreate(dns_task, "dns", 3072, NULL, 4, NULL);
}

/* ─── The page ────────────────────────────────────────────────────────── */

// Network names are whatever a neighbour typed.
static void escape(char *out, size_t size, const char *in) {
    size_t o = 0;
    for (; *in && o + 7 < size; in++) {
        const char *rep = *in == '&' ? "&amp;" : *in == '<' ? "&lt;" : *in == '>' ? "&gt;"
                        : *in == '"' ? "&quot;" : NULL;
        if (rep) { strcpy(out + o, rep); o += strlen(rep); }
        else out[o++] = *in;
    }
    out[o] = 0;
}

static const char *HEAD =
    "<!doctype html><html><head><meta charset=utf-8>"
    "<meta name=viewport content='width=device-width,initial-scale=1'><title>Charm setup</title><style>"
    "body{margin:0;padding:20px 16px 40px;background:#070611;color:#e8e6f0;"
    "font:16px/1.5 -apple-system,'Segoe UI','Helvetica Neue',Arial,sans-serif}"
    "main{max-width:440px;margin:0 auto;display:grid;gap:22px}h1{margin:0;font-size:26px}"
    "p{margin:0;color:#9a92b0}fieldset{border:1px solid #251d39;border-radius:14px;padding:14px;"
    "display:grid;gap:10px;margin:0}legend{padding:0 6px;color:#9a92b0;font-size:13px;"
    "letter-spacing:.1em;text-transform:uppercase}input{font:inherit;color:#e8e6f0;background:#0a0813;"
    "border:1px solid #342948;border-radius:10px;padding:10px 12px;width:100%;box-sizing:border-box}"
    "input:focus{outline:2px solid #8b35b8}.who{display:flex;gap:10px}.who label{flex:1}"
    ".who input{display:none}.who span{display:block;text-align:center;padding:12px;border-radius:999px;"
    "border:1px solid #342948;font-weight:600}.who input:checked+span{background:#8b35b8;border-color:#8b35b8}"
    ".row{display:grid;grid-template-columns:1fr 1fr;gap:8px}"
    "button{font-family:inherit;font-weight:600;font-size:16px;color:#fff;background:#8b35b8;border:0;border-radius:999px;padding:14px}"
    "small{color:#6f6788}</style></head><body><main>";

static esp_err_t page(httpd_req_t *req) {
    // Anything but the page is a phone checking whether it is online: send it here.
    if (strcmp(req->uri, "/") != 0) {
        httpd_resp_set_status(req, "302 Found");
        httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
        return httpd_resp_send(req, NULL, 0);
    }
    char *html = malloc(PAGE_MAX), esc[100];
    if (!html) return httpd_resp_send_500(req);
    int o = snprintf(html, PAGE_MAX, "%s<h1>Set up your charm</h1>"
        "<p>Saved on the charm itself. Leave a password or the key empty to keep the one it has.</p>"
        "<form method=post action=/save><fieldset><legend>Who is she</legend><div class=who>"
        "<label><input type=radio name=who value=eugenia %s><span>Eugenia</span></label>"
        "<label><input type=radio name=who value=gladys %s><span>Gladys</span></label></div></fieldset>"
        "<fieldset><legend>Wi-Fi, tried in order</legend><datalist id=near>",
        HEAD, cfg.gladys ? "" : "checked", cfg.gladys ? "checked" : "");
    for (int i = 0; i < n_seen && o < PAGE_MAX - 200; i++) {
        escape(esc, sizeof esc, (const char *)seen[i].ssid);
        o += snprintf(html + o, PAGE_MAX - o, "<option value=\"%s\">", esc);
    }
    o += snprintf(html + o, PAGE_MAX - o, "</datalist>");
    for (int i = 0; i < MAX_NETS && o < PAGE_MAX - 400; i++) {
        escape(esc, sizeof esc, i < cfg.n_nets ? cfg.nets[i].ssid : "");
        o += snprintf(html + o, PAGE_MAX - o,
            "<div class=row><input name=s%d list=near placeholder='Network %d' value=\"%s\" autocapitalize=off>"
            "<input name=p%d type=password placeholder='%s'></div>",
            i, i + 1, esc, i, i < cfg.n_nets ? "Keep password" : "Password");
    }
    snprintf(html + o, PAGE_MAX - o,
        "<small>Your phone's hotspot works too.</small></fieldset>"
        "<fieldset><legend>Her key</legend><input name=key type=password autocapitalize=off "
        "placeholder='%s'><small>EUGENIA_CHARM_SECRET or GLADYS_CHARM_SECRET, as set in Supabase.</small></fieldset>"
        "<fieldset><legend>Screen and checks</legend><div class=row>"
        "<label>Brightness %%<input name=bright type=number min=10 max=100 value=%d></label>"
        "<label>Gladys checks every (min)<input name=check type=number min=1 max=60 value=%d></label>"
        "</div></fieldset><button>Save</button></form></main></body></html>",
        cfg.key[0] ? "Keep the key she has" : "Paste her key", cfg.brightness, cfg.check_min);
    httpd_resp_set_type(req, "text/html");
    esp_err_t r = httpd_resp_sendstr(req, html);
    free(html);
    return r;
}

/* ─── Saving ──────────────────────────────────────────────────────────── */

// One field of a form body, decoded. False when the field is absent.
static bool field(const char *body, const char *name, char *out, size_t size) {
    size_t nl = strlen(name);
    for (const char *p = body; p && *p; p = strchr(p, '&') ? strchr(p, '&') + 1 : NULL) {
        if (strncmp(p, name, nl) || p[nl] != '=') continue;
        const char *v = p + nl + 1;
        size_t o = 0;
        while (*v && *v != '&' && o + 1 < size) {
            if (*v == '+') { out[o++] = ' '; v++; }
            else if (*v == '%' && isxdigit((unsigned char)v[1]) && isxdigit((unsigned char)v[2])) {
                char hex[3] = { v[1], v[2], 0 };
                out[o++] = (char)strtol(hex, NULL, 16);
                v += 3;
            } else out[o++] = *v++;
        }
        out[o] = 0;
        return true;
    }
    return false;
}

static esp_err_t save(httpd_req_t *req) {
    char body[BODY_MAX + 1], v[100];
    int len = 0;
    while (len < req->content_len && len < BODY_MAX) {
        int r = httpd_req_recv(req, body + len, BODY_MAX - len);
        if (r <= 0) return httpd_resp_send_500(req);
        len += r;
    }
    body[len] = 0;

    if (field(body, "who", v, sizeof v)) cfg.gladys = strcmp(v, "gladys") == 0;

    // A blank password keeps the one stored for that same network name.
    charm_net_t nets[MAX_NETS] = { 0 };
    int n = 0;
    for (int i = 0; i < MAX_NETS; i++) {
        char key[4];
        snprintf(key, sizeof key, "s%d", i);
        if (!field(body, key, nets[n].ssid, sizeof nets[n].ssid) || !nets[n].ssid[0]) continue;
        snprintf(key, sizeof key, "p%d", i);
        field(body, key, nets[n].pass, sizeof nets[n].pass);
        if (!nets[n].pass[0]) {
            for (int j = 0; j < cfg.n_nets; j++)
                if (!strcmp(cfg.nets[j].ssid, nets[n].ssid)) strcpy(nets[n].pass, cfg.nets[j].pass);
        }
        n++;
    }
    memcpy(cfg.nets, nets, sizeof nets);
    cfg.n_nets = n;

    if (field(body, "key", v, sizeof v) && v[0]) {
        strncpy(cfg.key, v, sizeof cfg.key - 1);
        cfg.key[sizeof cfg.key - 1] = 0;
    }
    if (field(body, "bright", v, sizeof v) && atoi(v) >= 10 && atoi(v) <= 100) cfg.brightness = atoi(v);
    if (field(body, "check", v, sizeof v) && atoi(v) >= 1 && atoi(v) <= 60) cfg.check_min = atoi(v);
    config_save();
    ESP_LOGI(TAG, "saved: %s, %d network(s), key %s", cfg.gladys ? "Gladys" : "Eugenia",
             cfg.n_nets, cfg.key[0] ? "set" : "missing");

    httpd_resp_set_type(req, "text/html");
    httpd_resp_sendstr(req, config_ready()
        ? "<!doctype html><meta name=viewport content='width=device-width'><body style='background:#070611;"
          "color:#e8e6f0;font:18px -apple-system,sans-serif;padding:40px 20px'>Saved. She is restarting.</body>"
        : "<!doctype html><meta name=viewport content='width=device-width'><body style='background:#070611;"
          "color:#e8e6f0;font:18px -apple-system,sans-serif;padding:40px 20px'>Saved, but she still needs "
          "a Wi-Fi network and her key. <a style='color:#b45cd9' href=/>Back</a></body>");
    if (config_ready()) {
        vTaskDelay(pdMS_TO_TICKS(1500));
        esp_restart();
    }
    return ESP_OK;
}

void setup_run(void) {
    start_network();
    show_screen();

    httpd_handle_t server = NULL;
    httpd_config_t conf = HTTPD_DEFAULT_CONFIG();
    conf.uri_match_fn = httpd_uri_match_wildcard;
    conf.stack_size = 8192;
    if (httpd_start(&server, &conf) == ESP_OK) {
        static const httpd_uri_t post = { .uri = "/save", .method = HTTP_POST, .handler = save };
        static const httpd_uri_t get = { .uri = "/*", .method = HTTP_GET, .handler = page };
        httpd_register_uri_handler(server, &post);
        httpd_register_uri_handler(server, &get);
    }
    ESP_LOGI(TAG, "waiting on %s", ap_name);
    for (;;) vTaskDelay(portMAX_DELAY);
}
