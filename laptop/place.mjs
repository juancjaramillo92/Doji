/* Where she is, shared by both processes and pure, so laptop.test.mjs drives
   it. Her place is her own square's — its corner and its side — and the
   window is built around that.

   The window is wider and taller than she is, for the journal's card beside
   her and the line she shows above her head: ROOM is its size in hers, CARD
   the card's width, and she is its bottom middle, with a card's width to
   either side. It lets clicks through but where she is drawn, so the room
   costs the chart beneath it nothing. */
export const CARD = 1.8;
export const ROOM = { width: 1 + 2 * CARD, height: 2.1 };

export function room(her) {
  const width = Math.round(her.side * ROOM.width), height = Math.round(her.side * ROOM.height);
  return { x: her.x - Math.round((width - her.side) / 2), y: her.y - (height - her.side), width, height };
}

export const within = (win, side) => ({ x: win.x + Math.round((win.width - side) / 2), y: win.y + win.height - side, side });

/* The card stands on his right of her, and on his left only where the screen
   ends before the card would. Her window reaches a card's width past her on
   each side, so the card fits on the right where the window does. */
export const fitsRight = (win, area) => win.x + win.width <= area.x + area.width;

/* The line is over her head, and moves along from there only as far as keeps
   it whole where the screen ends: her middle and the line's width go in, the
   line's middle comes out. It is never wider than the card, so wherever it
   lands is inside her window. */
export const lineAt = (mid, wide, area) => Math.min(Math.max(mid, area.x + wide / 2), area.x + area.width - wide / 2);

/* Where he left her, while that is still on a screen — her middle on any
   display's work area — or else the bottom-right corner of the main one. A
   place saved on a display since unplugged would leave her floating where
   nothing shows her. */
export function placed(saved, areas, main, inset = 24) {
  const { side } = saved;
  const cx = saved.x + side / 2, cy = saved.y + side / 2;
  const shown = Number.isFinite(cx) && Number.isFinite(cy) &&
    areas.some(a => cx >= a.x && cy >= a.y && cx < a.x + a.width && cy < a.y + a.height);
  return shown ? { x: saved.x, y: saved.y, side }
    : { x: main.x + main.width - side - inset, y: main.y + main.height - side - inset, side };
}

/* Tucked away, she peeks over the nearest edge of her screen: PEEK of her
   square is left showing, enough for her eyes. An edge is hers to hide behind
   only where the screen ends — not where the Dock or the menu bar sits, which
   would be drawn over her, and not where another display begins, which would
   show the rest of her. With no such edge there is nowhere to tuck: null. */
const PEEK = { left: 0.48, right: 0.5, bottom: 0.42 };

export function tucked(her, display, others) {
  const { bounds: b, workArea: w } = display, { side } = her;
  const beside = (o) => o.y < b.y + b.height && o.y + o.height > b.y;
  const free = {
    left: w.x === b.x && !others.some(o => beside(o) && o.x + o.width <= b.x),
    right: w.x + w.width === b.x + b.width && !others.some(o => beside(o) && o.x >= b.x + b.width),
    bottom: w.y + w.height === b.y + b.height && !others.some(o => o.y >= b.y + b.height && o.x < b.x + b.width && o.x + o.width > b.x),
  };
  const far = {
    left: her.x + side / 2 - b.x,
    right: b.x + b.width - (her.x + side / 2),
    bottom: b.y + b.height - (her.y + side / 2),
  };
  const [edge] = Object.keys(free).filter(e => free[e]).sort((p, q) => far[p] - far[q]);
  if (!edge) return null;
  const x = Math.min(Math.max(her.x, b.x), b.x + b.width - side), y = Math.min(Math.max(her.y, b.y), b.y + b.height - side);
  return {
    left: { x: b.x - Math.round(side * (1 - PEEK.left)), y, side, edge },
    right: { x: b.x + b.width - Math.round(side * PEEK.right), y, side, edge },
    bottom: { x, y: b.y + b.height - Math.round(side * PEEK.bottom), side, edge },
  }[edge];
}
