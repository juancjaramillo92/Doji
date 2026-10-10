#pragma once
#include <stddef.h>
#include <stdint.h>

/* Turns a DNS question, `n` bytes in `msg`, into the answer that the name is
   the charm, 192.168.4.1, in place; `size` is the room `msg` has. Returns the
   answer's length, or 0 for anything that is not a question. Pure, so a test
   compiles it on its own. */
size_t dns_answer(uint8_t *msg, size_t n, size_t size);
