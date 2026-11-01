/* The render is drawn on black, which on a laptop is a black square — around
   her face, and around her menu-bar icon. One rule makes it clear for both:
   a pixel's opacity is its brightest channel over CLEAR, so the glass keeps
   its colour to the rim and the black around it is gone. Pure, and shared by
   both processes. */
export const CLEAR = 48;

export const opacity = (r, g, b) => Math.min(1, Math.max(r, g, b) / CLEAR);

/* A square around her in the render's 466 pixels, for an icon with her
   filling it: every lit pixel of the render lies between columns 45 and 421
   and rows 53 and 384, inside it. */
export const BLOB = { x: 43, y: 28, width: 380, height: 380 };
