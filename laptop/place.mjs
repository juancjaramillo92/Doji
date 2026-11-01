/* Where her window goes, shared by both processes and pure, so laptop.test.mjs
   drives it.

   The window is wider and taller than she is, for the line she shows above
   her head: ROOM is its size in hers. It lets clicks through but where she is
   drawn, so the room costs the chart beneath it nothing. */
export const ROOM = { width: 1.6, height: 1.4 };

export const room = (side) => ({ width: Math.round(side * ROOM.width), height: Math.round(side * ROOM.height) });

/* Where he left her, while that is still on a screen — her middle on any
   display's work area — or else the bottom-right corner of the main one. A
   place saved on a display since unplugged would leave her floating where
   nothing shows her. */
export function placed(saved, areas, main, inset = 24) {
  const { width, height } = saved;
  const cx = saved.x + width / 2, cy = saved.y + height / 2;
  const shown = Number.isFinite(cx) && Number.isFinite(cy) &&
    areas.some(a => cx >= a.x && cy >= a.y && cx < a.x + a.width && cy < a.y + a.height);
  return shown ? { x: saved.x, y: saved.y, width, height }
    : { x: main.x + main.width - width - inset, y: main.y + main.height - height - inset, width, height };
}
