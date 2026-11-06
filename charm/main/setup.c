/* The setup. The charm becomes its own Wi-Fi network, locked with a password
   made up for this setup, and shows a QR code that carries both: a phone's
   camera joins it in one tap, and the page opens by itself, because every name
   the phone asks for resolves to the charm and every page but its own
   redirects there.

   The page (setup.html) asks for her Wi-Fi networks and the two keys, and
   each is tried before it is saved: a network by joining it, a key by asking
   its door, which can only be done once she is online. The charm's screen
   follows along — trying, then a tick or a cross — and finishing restarts her
   as herself. */
#include "setup.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bsp/esp-bsp.h"
#include "config.h"
#include "dns.h"
#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_http_client.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "lwip/sockets.h"
#include "net.h"
#include "palette.h"

static const char *TAG = "setup";

LV_FONT_DECLARE(hanken_18);

extern const char page_start[] asm("_binary_setup_html_start");
extern const uint8_t font_start[] asm("_binary_setup_woff2_start");
extern const uint8_t font_end[]   asm("_binary_setup_woff2_end");

#define BODY_MAX  512
#define SEEN_MAX  16
#define JOIN_MS   12000
#define CHECK_MS  10000
#define TICK_MS   1600   // how long the charm shows a tick or a cross
#define ALONE_MS  600000 // set up already, and no phone on her network this long: she gives up

#define JOINED  BIT0
#define REFUSED BIT1

// What the charm's screen says while it works; agree.test.mjs holds these,
// with the network's name, against the letters hanken_18 holds.
static const char *const SAY[] = { "Phone connected", "Carry on there", "Trying the Wi-Fi", "Checking the keys" };

static char ap_name[16], ap_pass[12];
// Under the code, her page's address, for a phone that does not open it alone.
static char address[24];
static EventGroupHandle_t events;
static volatile bool online;

/* ─── The screen ──────────────────────────────────────────────────────────
   Everything centred on the screen's own centre: the code on a white tile so
   any camera reads it, the network's name under it; the spinner; the tick or
   the cross alone. */

typedef enum { SHOW_CODE, SHOW_JOINED, SHOW_BUSY, SHOW_TICK, SHOW_CROSS } show_t;

static lv_obj_t *screens[5], *busy;

static lv_obj_t *text(lv_obj_t *parent, const char *s, uint32_t color, int32_t y) {
    lv_obj_t *l = lv_label_create(parent);
    lv_label_set_text_static(l, s);
    lv_obj_set_style_text_font(l, &hanken_18, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
    lv_obj_align(l, LV_ALIGN_TOP_MID, 0, y);
    return l;
}

static lv_obj_t *group(void) {
    lv_obj_t *g = lv_obj_create(lv_layer_top());
    lv_obj_remove_style_all(g);
    lv_obj_set_size(g, 466, 466);
    lv_obj_remove_flag(g, LV_OBJ_FLAG_CLICKABLE | LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_add_flag(g, LV_OBJ_FLAG_HIDDEN);
    return g;
}

static lv_obj_t *mark(const lv_point_precise_t *points, uint32_t n, uint32_t color) {
    lv_obj_t *g = group();
    lv_obj_t *l = lv_line_create(g);
    lv_line_set_points(l, points, n);
    lv_obj_set_style_line_width(l, 9, 0);
    lv_obj_set_style_line_rounded(l, true, 0);
    lv_obj_set_style_line_color(l, lv_color_hex(color), 0);
    return g;
}

static void build_screen(void) {
    static char wifi[64];
    snprintf(wifi, sizeof wifi, "WIFI:T:WPA;S:%s;P:%s;;", ap_name, ap_pass);

    bsp_display_lock(-1);
    screens[SHOW_CODE] = group();
    lv_obj_t *tile = lv_obj_create(screens[SHOW_CODE]);
    lv_obj_remove_style_all(tile);
    lv_obj_set_size(tile, 180, 180);
    lv_obj_set_pos(tile, 143, 143);
    lv_obj_set_style_bg_color(tile, lv_color_white(), 0);
    lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(tile, 18, 0);
    lv_obj_t *qr = lv_qrcode_create(tile);
    lv_qrcode_set_size(qr, 152);
    lv_qrcode_set_dark_color(qr, lv_color_black());
    lv_qrcode_set_light_color(qr, lv_color_white());
    lv_qrcode_update(qr, wifi, strlen(wifi));
    lv_obj_center(qr);
    text(screens[SHOW_CODE], ap_name, MUTED, 340);
    text(screens[SHOW_CODE], address, MUTED, 368);

    screens[SHOW_JOINED] = group();
    text(screens[SHOW_JOINED], SAY[0], INK, 204);
    text(screens[SHOW_JOINED], SAY[1], MUTED, 238);

    screens[SHOW_BUSY] = group();
    lv_obj_t *s = lv_spinner_create(screens[SHOW_BUSY]);
    lv_spinner_set_anim_params(s, 1000, 90);
    lv_obj_set_size(s, 74, 74);
    lv_obj_set_pos(s, 196, 177);
    lv_obj_set_style_arc_width(s, 6, LV_PART_MAIN);
    lv_obj_set_style_arc_color(s, lv_color_hex(0x16211b), LV_PART_MAIN);
    lv_obj_set_style_arc_width(s, 6, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(s, lv_color_hex(GLOW), LV_PART_INDICATOR);
    busy = text(screens[SHOW_BUSY], SAY[2], INK, 270);

    // A tick in two strokes and a cross, each with its box centred on (233, 233).
    static const lv_point_precise_t ticked[] = { { 203, 237 }, { 223, 257 }, { 263, 209 } };
    static const lv_point_precise_t crossed[] = { { 209, 209 }, { 257, 257 }, { 233, 233 }, { 257, 209 }, { 209, 257 } };
    screens[SHOW_TICK] = mark(ticked, 3, GLOW);
    screens[SHOW_CROSS] = mark(crossed, 5, CORAL);
    bsp_display_unlock();
}

// One screen at a time; busy says which of SAY's two waits it is.
static void show(show_t what, const char *doing) {
    bsp_display_lock(-1);
    for (int i = 0; i < 5; i++) lv_obj_add_flag(screens[i], LV_OBJ_FLAG_HIDDEN);
    if (doing) lv_label_set_text_static(busy, doing);
    lv_obj_remove_flag(screens[what], LV_OBJ_FLAG_HIDDEN);
    bsp_display_unlock();
}

/* The phone's step while one is on her network; the code again when none is,
   since its password is in nothing else. Testing a network moves her radio to
   that network's channel, and a phone that falls off then may not know the
   password to come back. */
static show_t phone_step(void) {
    wifi_sta_list_t on;
    return esp_wifi_ap_get_sta_list(&on) == ESP_OK && on.num ? SHOW_JOINED : SHOW_CODE;
}

// A tick or a cross for a moment, then back to the phone's step.
static void answer_shown(bool ok) {
    show(ok ? SHOW_TICK : SHOW_CROSS, NULL);
    vTaskDelay(pdMS_TO_TICKS(TICK_MS));
    show(phone_step(), NULL);
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
        int n = recvfrom(s, buf, sizeof buf, 0, (struct sockaddr *)&from, &fl);
        size_t len = n > 0 ? dns_answer(buf, (size_t)n, sizeof buf) : 0;
        if (len) sendto(s, buf, len, 0, (struct sockaddr *)&from, fl);
    }
}

// Her own leaving is no refusal, as in net.c; join() marks her offline itself.
static void on_event(void *arg, esp_event_base_t base, int32_t id, void *data) {
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STACONNECTED) show(SHOW_JOINED, NULL);
    if (base == WIFI_EVENT && id == WIFI_EVENT_AP_STADISCONNECTED) show(phone_step(), NULL);
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED &&
        ((wifi_event_sta_disconnected_t *)data)->reason != WIFI_REASON_ASSOC_LEAVE) {
        online = false;
        xEventGroupSetBits(events, REFUSED);
    }
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) { online = true; xEventGroupSetBits(events, JOINED); }
}

static void start_network(void) {
    events = xEventGroupCreate();
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_t *own = esp_netif_create_default_wifi_ap();
    esp_netif_create_default_wifi_sta();

    /* DHCP tells a phone that joins to ask her for every name, and where her
       page is (option 114, which newer phones open at once): a phone checks it
       is online before anything, and one whose check goes unanswered leaves.
       The server keeps the page's address by pointer, so it outlives this. */
    esp_netif_ip_info_t at;
    esp_netif_get_ip_info(own, &at);
    esp_netif_dns_info_t dns = { .ip = { .u_addr.ip4 = at.ip, .type = ESP_IPADDR_TYPE_V4 } };
    uint8_t offer = 1;
    static char page[24];
    snprintf(page, sizeof page, "http://" IPSTR, IP2STR(&at.ip));
    snprintf(address, sizeof address, "Open " IPSTR, IP2STR(&at.ip));
    esp_netif_dhcps_stop(own);
    esp_netif_set_dns_info(own, ESP_NETIF_DNS_MAIN, &dns);
    esp_netif_dhcps_option(own, ESP_NETIF_OP_SET, ESP_NETIF_DOMAIN_NAME_SERVER, &offer, sizeof offer);
    esp_netif_dhcps_option(own, ESP_NETIF_OP_SET, ESP_NETIF_CAPTIVEPORTAL_URI, page, strlen(page));
    esp_netif_dhcps_start(own);
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&init);
    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_event, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_event, NULL);

    // Her name from her own address; the password new for every setup, from
    // letters and digits no one misreads.
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_SOFTAP);
    snprintf(ap_name, sizeof ap_name, "Charm-%02X%02X", mac[4], mac[5]);
    static const char alphabet[] = "abcdefghjkmnpqrstuvwxyz23456789";
    for (size_t i = 0; i < sizeof ap_pass - 1; i++) ap_pass[i] = alphabet[esp_random() % (sizeof alphabet - 1)];

    wifi_config_t ap = { .ap = { .channel = 1, .max_connection = 2, .authmode = WIFI_AUTH_WPA2_PSK } };
    memcpy(ap.ap.ssid, ap_name, strlen(ap_name));
    ap.ap.ssid_len = strlen(ap_name);
    memcpy(ap.ap.password, ap_pass, strlen(ap_pass));
    esp_wifi_set_mode(WIFI_MODE_APSTA);
    esp_wifi_set_config(WIFI_IF_AP, &ap);
    esp_wifi_start();
    xTaskCreate(dns_task, "dns", 3072, NULL, 4, NULL);
}

// Joins one network, keeping her own up beside it. True once it gave an address.
static bool join(const char *ssid, const char *pass) {
    esp_wifi_disconnect();
    online = false;
    wifi_config_t sta = { 0 };
    memcpy(sta.sta.ssid, ssid, strlen(ssid));
    memcpy(sta.sta.password, pass, strlen(pass));
    esp_wifi_set_config(WIFI_IF_STA, &sta);
    xEventGroupClearBits(events, JOINED | REFUSED);
    esp_wifi_connect();
    return xEventGroupWaitBits(events, JOINED | REFUSED, pdTRUE, pdFALSE, pdMS_TO_TICKS(JOIN_MS)) & JOINED;
}

/* ─── The page's questions ─────────────────────────────────────────────── */

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

static bool body(httpd_req_t *req, char *out) {
    int len = 0;
    while (len < req->content_len && len < BODY_MAX) {
        int r = httpd_req_recv(req, out + len, BODY_MAX - len);
        if (r <= 0) return false;
        len += r;
    }
    out[len] = 0;
    return true;
}

// A network name is whatever a neighbour typed: escaped for JSON.
static int json_string(char *out, size_t size, const char *in) {
    size_t o = 0;
    out[o++] = '"';
    for (; *in && o + 8 < size; in++) {
        unsigned char c = (unsigned char)*in;
        if (c == '"' || c == '\\') { out[o++] = '\\'; out[o++] = c; }
        else if (c < 0x20) o += snprintf(out + o, size - o, "\\u%04x", c);
        else out[o++] = c;
    }
    out[o++] = '"';
    out[o] = 0;
    return (int)o;
}

static esp_err_t reply(httpd_req_t *req, const char *json) {
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, json);
}

// What she has, her network's name, and how many networks she keeps.
static esp_err_t api_state(httpd_req_t *req) {
    char out[1024];  // MAX_NETS names at their longest escaped, and the rest
    int o = snprintf(out, sizeof out, "{\"ready\":%s,\"name\":\"%s\",\"max\":%d,\"nets\":[",
                     config_ready() ? "true" : "false", ap_name, MAX_NETS);
    for (int i = 0; i < cfg.n_nets; i++) {
        if (i) out[o++] = ',';
        o += json_string(out + o, sizeof out - o, cfg.nets[i].ssid);
    }
    snprintf(out + o, sizeof out - o, "]}");
    return reply(req, out);
}

// The networks in range, strongest first, each once, as one to three bars
// and whether it asks for a password.
static esp_err_t api_scan(httpd_req_t *req) {
    static wifi_ap_record_t seen[SEEN_MAX];
    uint16_t n = SEEN_MAX;
    if (esp_wifi_scan_start(NULL, true) != ESP_OK || esp_wifi_scan_get_ap_records(&n, seen) != ESP_OK) n = 0;
    static char out[1400];
    int o = snprintf(out, sizeof out, "[");
    // An entry is written only with room for the longest one: a name of 32
    // control characters, each escaped to six, and the rest of its object.
    for (int i = 0; i < n && o < (int)sizeof out - 240; i++) {
        const char *ssid = (const char *)seen[i].ssid;
        bool again = !ssid[0];
        for (int j = 0; j < i && !again; j++) again = !strcmp(ssid, (const char *)seen[j].ssid);
        if (again) continue;
        if (o > 1) out[o++] = ',';
        o += snprintf(out + o, sizeof out - o, "{\"ssid\":");
        o += json_string(out + o, sizeof out - o, ssid);
        o += snprintf(out + o, sizeof out - o, ",\"bars\":%d,\"lock\":%s}", seen[i].rssi > -60 ? 3 : seen[i].rssi > -75 ? 2 : 1,
                      seen[i].authmode == WIFI_AUTH_OPEN ? "false" : "true");
    }
    snprintf(out + o, sizeof out - o, "]");
    return reply(req, out);
}

// Where a saved network sits, or n_nets when it is not saved.
static int saved_at(const char *ssid) {
    int at = 0;
    while (at < cfg.n_nets && strcmp(cfg.nets[at].ssid, ssid)) at++;
    return at;
}

/* Tried before it is saved; a name already saved has its password replaced.
   A new one past MAX_NETS is refused untried: one has to be removed first,
   rather than any being replaced without a word. */
static esp_err_t api_wifi(httpd_req_t *req) {
    char in[BODY_MAX + 1];
    charm_net_t net = { 0 };
    if (!body(req, in) || !field(in, "ssid", net.ssid, sizeof net.ssid) || !net.ssid[0]) return reply(req, "{\"ok\":false}");
    field(in, "pass", net.pass, sizeof net.pass);
    int at = saved_at(net.ssid);
    if (at == MAX_NETS) return reply(req, "{\"ok\":false,\"why\":\"full\"}");
    show(SHOW_BUSY, SAY[2]);
    bool ok = join(net.ssid, net.pass);
    if (ok) {
        cfg.nets[at] = net;
        if (at == cfg.n_nets) cfg.n_nets++;
        config_save();
    }
    ESP_LOGI(TAG, "%s %s", net.ssid, ok ? "joined" : "refused");
    reply(req, ok ? "{\"ok\":true}" : "{\"ok\":false}");
    answer_shown(ok);
    return ESP_OK;
}

/* A key is right when its door lets it in. Eugenia's is asked with an empty
   recording, which a right key is refused with a 400 for, and which costs
   nothing; Gladys's is asked what waits. A 503 is a right key at a door short
   of a secret of its own. */
static esp_err_t api_key(httpd_req_t *req) {
    char in[BODY_MAX + 1], who[12] = "", key[sizeof cfg.eugenia_key] = "";
    if (!body(req, in) || !field(in, "who", who, sizeof who) || !field(in, "key", key, sizeof key) || !key[0])
        return reply(req, "{\"ok\":false,\"why\":\"refused\"}");
    bool eugenia = !strcmp(who, "eugenia");
    show(SHOW_BUSY, SAY[3]);
    // Online on a saved network, if she is not already.
    for (int i = 0; i < cfg.n_nets && !online; i++) join(cfg.nets[i].ssid, cfg.nets[i].pass);
    if (!online) {
        show(phone_step(), NULL);
        return reply(req, "{\"ok\":false,\"why\":\"offline\"}");
    }
    esp_http_client_config_t c = {
        .url = eugenia ? EUGENIA_DOOR : GLADYS_DOOR,
        .method = eugenia ? HTTP_METHOD_POST : HTTP_METHOD_GET,
        .timeout_ms = CHECK_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
    };
    esp_http_client_handle_t h = esp_http_client_init(&c);
    esp_http_client_set_header(h, "x-charm-key", key);
    int status = esp_http_client_perform(h) == ESP_OK ? esp_http_client_get_status_code(h) : -1;
    esp_http_client_cleanup(h);
    bool ok = status == 503 || (eugenia ? status == 400 : status == 200);
    if (ok) {
        strlcpy(eugenia ? cfg.eugenia_key : cfg.gladys_key, key, sizeof cfg.eugenia_key);
        config_save();
    }
    ESP_LOGI(TAG, "%s's key: her door answered %d", who, status);
    reply(req, ok ? "{\"ok\":true}" : status < 0 ? "{\"ok\":false,\"why\":\"offline\"}" : "{\"ok\":false,\"why\":\"refused\"}");
    answer_shown(ok);
    return ESP_OK;
}

// A saved network forgotten; the ones after it move up a place.
static esp_err_t api_forget(httpd_req_t *req) {
    char in[BODY_MAX + 1], ssid[sizeof cfg.nets[0].ssid];
    if (!body(req, in) || !field(in, "ssid", ssid, sizeof ssid)) return reply(req, "{\"ok\":false}");
    int at = saved_at(ssid);
    if (at == cfg.n_nets) return reply(req, "{\"ok\":false}");
    memmove(&cfg.nets[at], &cfg.nets[at + 1], (cfg.n_nets - at - 1) * sizeof cfg.nets[0]);
    memset(&cfg.nets[--cfg.n_nets], 0, sizeof cfg.nets[0]);
    config_save();
    ESP_LOGI(TAG, "%s forgotten", ssid);
    reply(req, "{\"ok\":true}");
    answer_shown(true);
    return ESP_OK;
}

static esp_err_t api_finish(httpd_req_t *req) {
    reply(req, "{\"ok\":true}");
    vTaskDelay(pdMS_TO_TICKS(800));
    esp_restart();
    return ESP_OK;
}

// Doji's typeface, carried in her flash since the phone has no internet to
// fetch it from while it is on her network.
static esp_err_t font(httpd_req_t *req) {
    httpd_resp_set_type(req, "font/woff2");
    httpd_resp_set_hdr(req, "Cache-Control", "max-age=31536000");
    return httpd_resp_send(req, (const char *)font_start, font_end - font_start);
}

// Anything but the page and its questions is a phone checking whether it is
// online: send it to the page.
static esp_err_t page(httpd_req_t *req) {
    if (strcmp(req->uri, "/") != 0) {
        httpd_resp_set_status(req, "302 Found");
        httpd_resp_set_hdr(req, "Location", "http://192.168.4.1/");
        return httpd_resp_send(req, NULL, 0);
    }
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_sendstr(req, page_start);
}

void setup_run(void) {
    start_network();
    build_screen();
    show(SHOW_CODE, NULL);

    httpd_handle_t server = NULL;
    httpd_config_t conf = HTTPD_DEFAULT_CONFIG();
    conf.uri_match_fn = httpd_uri_match_wildcard;
    // A phone that has just joined opens several connections at once, past
    // the server's seven; the oldest is closed for a new one rather than the
    // new one refused, and the phone's check that it is online answered.
    conf.lru_purge_enable = true;
    conf.stack_size = 10240;  // a key is checked over TLS from its handler
    if (httpd_start(&server, &conf) == ESP_OK) {
        // In order: the questions before the page that answers every other path.
        static const httpd_uri_t uris[] = {
            { .uri = "/api/state",  .method = HTTP_GET,  .handler = api_state },
            { .uri = "/api/scan",   .method = HTTP_GET,  .handler = api_scan },
            { .uri = "/api/wifi",   .method = HTTP_POST, .handler = api_wifi },
            { .uri = "/api/key",    .method = HTTP_POST, .handler = api_key },
            { .uri = "/api/forget", .method = HTTP_POST, .handler = api_forget },
            { .uri = "/api/finish", .method = HTTP_POST, .handler = api_finish },
            { .uri = "/font.woff2", .method = HTTP_GET,  .handler = font },
            { .uri = "/*",          .method = HTTP_GET,  .handler = page },
        };
        for (size_t i = 0; i < sizeof uris / sizeof *uris; i++) httpd_register_uri_handler(server, &uris[i]);
    }
    ESP_LOGI(TAG, "waiting on %s", ap_name);
    // Left alone — BOOT held in a pocket, or a phone that never came — a charm
    // already set up restarts as herself rather than keep her network and the
    // code on her screen up until the battery is gone. One never set up has
    // nothing else to be, and waits.
    TickType_t seen = xTaskGetTickCount();
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(1000));
        wifi_sta_list_t phones;
        if (esp_wifi_ap_get_sta_list(&phones) == ESP_OK && phones.num) seen = xTaskGetTickCount();
        if (config_ready() && xTaskGetTickCount() - seen >= pdMS_TO_TICKS(ALONE_MS)) esp_restart();
    }
}
