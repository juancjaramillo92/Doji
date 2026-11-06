#include "briefing.h"

#include "esp_attr.h"
#include "net.h"

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

static RTC_DATA_ATTR int announced;  // yyyymmdd, New York

static int day_of(const struct tm *t) {
    return (t->tm_year + 1900) * 10000 + (t->tm_mon + 1) * 100 + t->tm_mday;
}

bool briefing_due(time_t now) {
    if (now < CLOCK_SET) return false;
    struct tm t;
    localtime_r(&now, &t);
    int hour = t.tm_wday == 0 ? BRIEF_SUNDAY : t.tm_wday <= 5 ? BRIEF_WEEKDAY : -1;
    if (hour < 0 || day_of(&t) == announced) return false;
    int minute = t.tm_hour * 60 + t.tm_min;
    return minute >= hour * 60 + FIRST_ASK_MIN && minute < (hour + BRIEF_RETRIES + 1) * 60;
}

void briefing_announced(time_t now) {
    struct tm t;
    localtime_r(&now, &t);
    announced = day_of(&t);
}

bool briefing_today(time_t now) {
    struct tm t;
    localtime_r(&now, &t);
    return day_of(&t) == announced;
}
