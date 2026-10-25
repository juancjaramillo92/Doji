#pragma once
#include <stdbool.h>
#include <stdint.h>

/* Her glass: the body that breathes and wobbles, and the bubbles that rise
   inside it. Pure, so a test compiles it on its own and drives it; face.c
   draws what it says.

   The body is a set of renders along one axis, from stretched to squashed
   (charm/tools/art.py, which reads the three numbers below): a breath walks
   gently up and down it, a wobble bounces along it and settles, so one set
   of renders is both. A render is drawn as it is, never transformed, and the
   face rides it through glass_place. The bubbles live in the body at rest,
   in screen pixels, and are placed on whichever render shows. */
#define GLASS_FRAMES  13   // the renders, ascending in squash, one of them at rest
#define GLASS_SIZES   3    // the bubbles' sizes
#define GLASS_PHASES  4    // each bubble drawn at quarter pixels, so a slow one glides rather than steps
#define GLASS_BUBBLES 12   // at most at once

/* Measured off the render and made with the art, by charm/tools/art.py, in
   art.c: the patch every render is cut to (x, y, width, height), the point
   the body squashes about, each render's squash, her outline at rest — each
   row of the screen, the first and last column of her glass, {0, -1} where
   she does not reach — and the bubbles' radii and the side of their
   sprites. */
extern const int16_t GLASS_CROP[4];
extern const float GLASS_ANCHOR[2];
extern const float GLASS_SQUASH[GLASS_FRAMES];
extern const int16_t GLASS_OUTLINE[466][2];
extern const float GLASS_RADIUS[GLASS_SIZES];
extern const uint8_t GLASS_SIDE[GLASS_SIZES];

typedef struct {
    float x, y, vx, vy;  // at rest, in pixels and pixels a second
    float shown;         // 0 to 1, fading in as it starts, out as it pops
    float sway;          // the phase of its side-to-side
    uint8_t size;        // one of GLASS_SIZES
    uint8_t state;       // GLASS_NONE, GLASS_RISING or GLASS_POPPING
} glass_bubble_t;

enum { GLASS_NONE, GLASS_RISING, GLASS_POPPING };

typedef struct {
    glass_bubble_t bubbles[GLASS_BUBBLES];
    float shape;         // the squash showing: the breath and the wobble together
    float wobble, give;  // the wobble, and how fast it is moving
    float deep, breath;  // the breath's depth as it eases, and how far through it, 0 to 1
    float next;          // seconds until the next bubble
    uint32_t seed;
} glass_t;

/* What her mood asks of the glass, from face.c's modes. */
typedef struct {
    float up[2];   // which way is up on the screen (x right, y down), its length how upright she is held, 0 to 1
    float rise;    // how fast a bubble rises, pixels a second, held upright
    float every;   // seconds between new bubbles, about
    int most;      // how many at once, up to GLASS_BUBBLES
    float stir;    // 0 to 1: shaken, by his voice or a jolt
    float depth;   // the breath, as a squash toward stretched; 0 holds it
    float period;  // seconds a breath takes
} glass_mood_t;

void glass_start(glass_t *g, uint32_t seed);

// A tap or a jolt, 0 to 1: the body squashes, then bounces back to rest.
void glass_poke(glass_t *g, float strength);

void glass_step(glass_t *g, const glass_mood_t *m, float dt);

// The render nearest the squash showing.
int glass_frame(const glass_t *g);

/* A render's stretch across and down: wider and shorter as it squashes, by
   one over the other, so she keeps her volume. */
void glass_scale(int frame, float scale[2]);

// A point of the body at rest, where a render shows it.
void glass_place(int frame, float x, float y, float at[2]);

/* The chord of her through (x, y) along (dx, dy), `margin` inside her edge:
   its two ends, or false when (x, y) is not inside. The sheen's streak. */
bool glass_chord(float x, float y, float dx, float dy, float margin, float ends[4]);
