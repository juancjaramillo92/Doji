#include "errand.h"

#define CHECK_S    300    // how often she asks what waits
#define CHARGING_S 120    // on the cable, how often the charge is redrawn
#define LONGEST_S  1800   // under the hour, so every hour has an errand

int errand_wait(bool charging, int away) {
    if (charging) return CHARGING_S;
    int wait = CHECK_S << (away < 3 ? away : 3);
    return wait < LONGEST_S ? wait : LONGEST_S;
}
