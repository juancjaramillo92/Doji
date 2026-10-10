#pragma once
#include <stdbool.h>

/* Everything the setup page asks for, and the volume her dial sets, kept in
   the chip's own flash (NVS, namespace "charm"). Nothing here is built into
   the firmware, which is why one file installs on both boards. */
#define MAX_NETS 4

typedef struct {
    char ssid[33];
    char pass[65];
} charm_net_t;

typedef struct {
    bool gladys;                 // which character this board is
    charm_net_t nets[MAX_NETS];  // tried in order
    int n_nets;
    char key[80];                // her charm secret, EUGENIA_ or GLADYS_CHARM_SECRET
    int brightness;              // percent
    int check_min;               // how often Gladys asks what waits
    int volume;                  // percent, from the dial round the rim
} charm_config_t;

extern charm_config_t cfg;

void config_load(void);
void config_save(void);

// A board with no network or no key can do nothing but ask to be set up.
bool config_ready(void);

// The setup page on the next start: set by holding the screen, cleared there.
void config_ask_setup(void);
bool config_take_setup_request(void);
