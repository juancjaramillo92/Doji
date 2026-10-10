#include "briefing.h"

#include "esp_attr.h"

/* The briefing's hours in New York: weekdays at BRIEF_WEEKDAY, Sunday at
   BRIEF_SUNDAY, each tried again on the hour for BRIEF_RETRIES hours, and none
   on a Saturday. A copy of doji-eugenia's briefDue and retryDue, which
   agree.test.mjs holds it against. */
#define BRIEF_WEEKDAY 8
#define BRIEF_SUNDAY  17
#define BRIEF_RETRIES 3

// Writing takes up to six minutes, so the first ask is at five past and the
// asking runs through the hour the last retry starts.
#define FIRST_ASK_MIN 5
#define ASK_EVERY_S   (10 * 60)

// Unset, the clock reads 1970.
#define CLOCK_SET     1767225600  // 2026-01-01
#define UNSET_ASK_S   (30 * 60)

static RTC_DATA_ATTR int announced;  // yyyymmdd, New York

static int day_of(const struct tm *t) {
    return (t->tm_year + 1900) * 10000 + (t->tm_mon + 1) * 100 + t->tm_mday;
}

// mktime settles the day and the clock change, so `day` may run past a month.
static time_t at(struct tm day, int hour, int min) {
    day.tm_hour = hour; day.tm_min = min; day.tm_sec = 0; day.tm_isdst = -1;
    return mktime(&day);
}

time_t briefing_next_ask(time_t now) {
    if (now < CLOCK_SET) return now + UNSET_ASK_S;
    struct tm today;
    localtime_r(&now, &today);
    for (int d = 0; d < 8; d++) {
        struct tm day = today;
        day.tm_mday += d;
        time_t noon = at(day, 12, 0);
        localtime_r(&noon, &day);
        int hour = day.tm_wday == 0 ? BRIEF_SUNDAY : day.tm_wday <= 5 ? BRIEF_WEEKDAY : -1;
        if (hour < 0 || day_of(&day) == announced) continue;
        time_t first = at(day, hour, FIRST_ASK_MIN), last = at(day, hour + BRIEF_RETRIES + 1, 0);
        if (now < first) return first;
        if (now + ASK_EVERY_S < last) return now + ASK_EVERY_S;
    }
    return 0;
}

void briefing_announced(time_t now) {
    struct tm t;
    localtime_r(&now, &t);
    announced = day_of(&t);
}
