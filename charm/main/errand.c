#include "errand.h"

#include "net.h"

#define CHECK_S    300    // how often she asks what waits
#define CHARGING_S 120    // on the cable, how often the charge is redrawn
#define LONGEST_S  1800   // under the hour, so every hour has an errand

/* The market's week in New York: Sunday at ROLL_HOUR to Friday at ROLL_HOUR.
   A copy of marketOpen in _shared/edge.ts, which agree.test.mjs holds it
   against. A trade's row can follow the close by the poller's and the
   email's lag, so the quiet starts GRACE_H later. */
#define ROLL_HOUR 17
#define GRACE_H   1

int errand_wait(time_t now, bool charging, bool trade, int away) {
    if (charging) return CHARGING_S;
    int wait = CHECK_S << (away < 3 ? away : 3);
    if (wait > LONGEST_S) wait = LONGEST_S;
    struct tm t;
    localtime_r(&now, &t);
    bool weekend = (t.tm_wday == 5 && t.tm_hour >= ROLL_HOUR + GRACE_H) || t.tm_wday == 6 ||
                   (t.tm_wday == 0 && t.tm_hour < ROLL_HOUR);
    if (trade || now < CLOCK_SET || !weekend) return wait;
    // The Sunday open, where errands come every few minutes again.
    struct tm open = t;
    open.tm_mday += (7 - t.tm_wday) % 7;
    open.tm_hour = ROLL_HOUR;
    open.tm_min = open.tm_sec = 0;
    open.tm_isdst = -1;
    time_t to_open = mktime(&open) - now;
    return to_open < LONGEST_S ? (int)to_open : LONGEST_S;
}
