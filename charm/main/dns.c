#include "dns.h"

#include <string.h>

size_t dns_answer(uint8_t *msg, size_t n, size_t size) {
    static const uint8_t answer[] = { 0xC0, 0x0C, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 168, 4, 1 };
    // The answer follows the first question, and anything after it — the EDNS
    // record a phone may add — is dropped; left in, it would be read as the
    // answer.
    size_t q = 12;
    while (q < n && msg[q]) q += msg[q] + 1u;
    q += 5;  // the name's closing byte, its type and its class
    if (n < 12 || q > n || q + sizeof answer > size) return 0;
    msg[2] = 0x81; msg[3] = 0x80;          // a response, recursion available
    msg[4] = 0; msg[5] = 1;                // the one question
    msg[6] = 0; msg[7] = 1;                // one answer
    msg[8] = msg[9] = msg[10] = msg[11] = 0;
    memcpy(msg + q, answer, sizeof answer);
    return q + sizeof answer;
}
