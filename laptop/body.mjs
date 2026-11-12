/* What her body decides, shared with nothing and pure, so laptop.test.mjs
   drives it: how she gives and settles, where a throw carries her, and when
   she sleeps. The page draws what these return. */

/* One spring, toward rest: `s` is where it is and how fast it moves. She is
   glass, so it rings a few times and stops — and stops exactly, or a body
   that never quite settles is drawn at its full rate for ever. */
export function settle(s, stiffness, damping, dt) {
  s.v += (-stiffness * s.x - damping * s.v) * dt;
  s.x += s.v * dt;
  if (Math.abs(s.x) < 0.001 && Math.abs(s.v) < 0.01) s.x = s.v = 0;
}

/* A throw: she slides on from where he let go, slowing, and comes back off
   the edge of the screen she is on. `box` is her shape on the screen and its
   velocity in pixels a second; an edge turns her only while she is moving
   out through it, so one let go half off the screen is not snatched back.
   Slower than FLING at the release is a drop, and under REST she has
   stopped. */
export const FLING = 900;
const FRICTION = 2.6, BOUNCE = 0.55, REST = 40;

export function slide(box, area, dt) {
  const k = Math.exp(-FRICTION * dt);
  let { x, y, vx, vy } = box, hit = false;
  vx *= k; vy *= k;
  x += vx * dt; y += vy * dt;
  if (x < area.x && vx < 0 || x + box.width > area.x + area.width && vx > 0) { vx *= -BOUNCE; hit = true; }
  if (y < area.y && vy < 0 || y + box.height > area.y + area.height && vy > 0) { vy *= -BOUNCE; hit = true; }
  return { ...box, x, y, vx, vy, hit, done: Math.hypot(vx, vy) < REST };
}

/* Gold's week, Sunday 17:00 to Friday 17:00 in New York: a copy of the
   poller's marketOpen, which laptop.test.mjs runs beside this one hour by
   hour. */
const NEW_YORK = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' });

export function marketOpen(now) {
  const at = Object.fromEntries(NEW_YORK.formatToParts(now).map(p => [p.type, p.value]));
  const hour = Number(at.hour);
  return !(at.weekday === 'Sat' || at.weekday === 'Fri' && hour >= 17 || at.weekday === 'Sun' && hour < 17);
}

/* She sleeps when there is nothing to be awake for. With the market shut,
   that is DOZE_MS after the cursor last came near her; with it open, only
   once the cursor has not moved at all for AWAY_MS — he is working his chart
   all day far from her, and that is not being away. */
export const DOZE_MS = 20_000, AWAY_MS = 5 * 60_000;

export const sleeps = (open, sinceNear, sinceMoved) => (open ? sinceMoved >= AWAY_MS : sinceNear >= DOZE_MS);
